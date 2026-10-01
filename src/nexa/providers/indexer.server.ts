import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { BSC_CHAIN_ID, FLAP_LAUNCHED_TO_DEX_TOPIC, FLAP_PORTAL_ADDRESS, FLAP_TOKEN_CREATED_TOPIC } from "../config";
import type { AutonomyCounters, ExecutionMode, IntegrationName, IntegrationStatus, NexaEvent, ReadinessCheck, StreamPacket, SystemSnapshot, TokenIdentity, TokenRef } from "../types";
import { EMPTY_COUNTERS, countEvent, effectiveTradeSize, evaluateProtection } from "../agent/rules";
import { readHardLimits } from "../agent/policy-config.server";
import { signerStatus } from "../agent/signer.server";
import { decide } from "../agent/brain";
import { drainExecutionEvents, dryRunLedger, ledgerStats, loadLedger, reconcileConfirmedPositions, runIntent, type ExecutionEvent } from "../agent/executor.server";
import { positionSnapshots, updatePositionMarket } from "../agent/positions.server";
import { hexToNumber, rpc, rpcReport, weiHexToBnb } from "./bsc-rpc.server";
import { bnbUsd, bnbUsdFresh, findPair, onchainPricing, PANCAKE_V2_ROUTER, type PriceQuote } from "./pricing.server";
import { holderIndexReport, holderMetrics, indexHolders, saveHolders, trackToken } from "./holders.server";
import { selector, word, wordAddress, wordBig, topicAddress, type Hex } from "./eth.server";
import { resolveTokenIdentity, tokenIdentityCatalog, updateTokenMetrics } from "./token-metadata.server";

type RpcLog = { blockNumber: string; transactionHash: Hex; data: Hex; address: Hex; logIndex: string; topics: string[] };
interface Tracked { token: TokenRef; identity?: TokenIdentity; creator: Hex; createdBlock: number; metaCid?: string; decimals?: number; totalSupply?: string; lastPriceBnb?: number; lastDecisionAt?: number; launchedToDex?: boolean }
const MAX_RANGE = 200;
let lastBlock: number | undefined;
let lastPacket: StreamPacket | undefined;
let packetAt = 0;
let loaded = false;
let counters: AutonomyCounters = EMPTY_COUNTERS;
let tracked: Tracked[] = [];
let selfToken: TokenRef | undefined;
let chainIdVerified: boolean | undefined;
let portalHasCode: boolean | undefined;
let walletState: { nonce?: number; balance?: string } = {};
let lastIndexError: string | undefined;
const riskMultiplier = 1;

const checkpointPath = () => resolve(process.env["NEXA_CHECKPOINT_PATH"]?.trim() || ".data/nexa-checkpoint.json");
const wallet = () => { const value = process.env["NEXA_WALLET_ADDRESS"]?.trim(); return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Hex) : undefined; };
async function load() {
  if (loaded) return; loaded = true;
  try {
    const parsed = JSON.parse(await readFile(checkpointPath(), "utf8")) as { chainId?: number; lastBlock?: number; counters?: AutonomyCounters; tracked?: Tracked[]; selfToken?: TokenRef };
    if (parsed.chainId === BSC_CHAIN_ID && Number.isSafeInteger(parsed.lastBlock)) lastBlock = parsed.lastBlock;
    counters = { ...EMPTY_COUNTERS, ...parsed.counters }; tracked = parsed.tracked ?? []; selfToken = parsed.selfToken;
  } catch { /* first boot */ }
  await loadLedger();
  for (const item of tracked.filter((entry) => !entry.identity).slice(0, 40)) {
    const identity = await resolveTokenIdentity({ address: item.token.address, creator: item.creator, createdBlock: item.createdBlock, detectedAt: new Date().toISOString(), ...(item.token.name ? { eventName: item.token.name } : {}), ...(item.token.symbol ? { eventSymbol: item.token.symbol } : {}), ...(item.metaCid ? { metaCid: item.metaCid } : {}) }).catch(() => undefined);
    if (identity) item.identity = identity;
  }
  for (const event of await reconcileConfirmedPositions()) receiptQueuePush(event);
}
function receiptQueuePush(event: ExecutionEvent) { recoveredExecutionEvents.push(event); }
const recoveredExecutionEvents: ExecutionEvent[] = [];
async function save() {
  const path = checkpointPath(); await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify({ chainId: BSC_CHAIN_ID, lastBlock, counters, tracked: tracked.slice(0, 40), selfToken, updatedAt: new Date().toISOString() }));
  await rename(`${path}.tmp`, path);
}
const src = (provider: "bsc-rpc" | "flap-portal" | "nexa-agent", endpoint?: string) => ({ provider, mode: "live" as const, verifiable: true as const, ...(endpoint ? { rpcUrlLabel: endpoint } : {}) });
function decodeString(data: string, index: number) {
  const offset = Number.parseInt(word(data, index), 16) * 2 + 2; const length = Number.parseInt(data.slice(offset, offset + 64), 16);
  try { return new TextDecoder().decode(Uint8Array.from(data.slice(offset + 64, offset + 64 + length * 2).match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16))); } catch { return ""; }
}
async function erc20Meta(token: Hex) {
  const [decimals, supply] = await Promise.all([rpc<string>("eth_call", [{ to: token, data: selector("decimals()") }, "latest"]), rpc<string>("eth_call", [{ to: token, data: selector("totalSupply()") }, "latest"])]);
  return { decimals: Number(wordBig(decimals.value, 0)), totalSupply: wordBig(supply.value, 0).toString() };
}

function executionModeFor(signer: ReturnType<typeof signerStatus>, checks: ReadinessCheck[]): { requested: ExecutionMode; effective: ExecutionMode; livePermitted: boolean } {
  const raw = process.env["NEXA_EXECUTION_MODE"]?.trim().toUpperCase();
  const requested: ExecutionMode = raw === "SIGNER_READY" || raw === "DRY_RUN" || raw === "LIVE_LIMITED" || raw === "LIVE_AUTONOMOUS" || raw === "NO_SIGNER" ? raw : "DRY_RUN";
  const signerOk = signer.valid && Boolean(wallet()) && signer.address?.toLowerCase() === wallet()?.toLowerCase();
  if (!signerOk || requested === "NO_SIGNER") return { requested, effective: "NO_SIGNER", livePermitted: false };
  const allPass = checks.every((check) => check.ok);
  const autonomousConfirmed = process.env["NEXA_LIVE_AUTONOMOUS_CONFIRM"]?.trim() === "I_ACCEPT_UNATTENDED_RISK";
  if (requested === "LIVE_LIMITED" && allPass) return { requested, effective: "LIVE_LIMITED", livePermitted: true };
  if (requested === "LIVE_AUTONOMOUS" && allPass && autonomousConfirmed) return { requested, effective: "LIVE_AUTONOMOUS", livePermitted: true };
  if (requested === "SIGNER_READY") return { requested, effective: "SIGNER_READY", livePermitted: false };
  return { requested, effective: "DRY_RUN", livePermitted: false };
}

export async function readLivePacket(): Promise<StreamPacket> {
  await load();
  if (lastPacket && Date.now() - packetAt < 2_500) return lastPacket;
  const limits = readHardLimits();
  const signer = signerStatus();
  const head = await rpc<string>("eth_blockNumber");
  const headBlock = hexToNumber(head.value);
  const observedAt = new Date().toISOString();
  if (chainIdVerified === undefined) chainIdVerified = hexToNumber((await rpc<string>("eth_chainId")).value) === BSC_CHAIN_ID;
  if (portalHasCode === undefined) portalHasCode = (await rpc<string>("eth_getCode", [FLAP_PORTAL_ADDRESS, "latest"])).value.length > 2;
  const headInfo = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [head.value, false]);
  const blockAgeSeconds = Math.max(0, Math.floor(Date.now() / 1000) - hexToNumber(headInfo.value.timestamp));
  const events: NexaEvent[] = [];
  const push = (event: Omit<NexaEvent, "chainId" | "timestamp"> & { timestamp?: string }) => events.push({ chainId: 56, timestamp: observedAt, ...event });
  let flapOk = true;
  let lag = 0;
  const usd = await bnbUsd().catch(() => null);

  if (lastBlock !== headBlock) {
    push({ id: `block-${headBlock}`, type: "SYSTEM_STATUS", priority: "low", blockNumber: headBlock, source: src("bsc-rpc", head.endpoint), data: { message: `Observed BSC block #${headBlock.toLocaleString()}.`, kind: "NEW_BLOCK" } });
    const from = lastBlock === undefined ? headBlock : lastBlock + 1;
    const to = Math.min(headBlock, from + MAX_RANGE - 1);
    lag = headBlock - to;
    const analyses: Tracked[] = [];
    try {
      const logs = await rpc<RpcLog[]>("eth_getLogs", [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, address: FLAP_PORTAL_ADDRESS, topics: [[FLAP_TOKEN_CREATED_TOPIC, FLAP_LAUNCHED_TO_DEX_TOPIC]] }]);
      for (const log of logs.value) {
        const blockNumber = hexToNumber(log.blockNumber);
        if (log.topics[0] === FLAP_TOKEN_CREATED_TOPIC) {
          const creator = wordAddress(log.data, 1), address = wordAddress(log.data, 3);
          const eventName = decodeString(log.data, 4), eventSymbol = decodeString(log.data, 5), metaCid = decodeString(log.data, 6);
          const detectedAt = (await rpc<{ timestamp: string }>("eth_getBlockByNumber", [log.blockNumber, false]).catch(() => null));
          const identity = await resolveTokenIdentity({ address, creator, createdBlock: blockNumber, detectedAt: detectedAt ? new Date(hexToNumber(detectedAt.value.timestamp) * 1000).toISOString() : observedAt, eventName, eventSymbol, metaCid });
          const token: TokenRef = { address, ...(identity.name ? { name: identity.name } : {}), ...(identity.symbol ? { symbol: identity.symbol } : {}) };
          const entry: Tracked = { token, identity, creator, createdBlock: blockNumber, ...(metaCid ? { metaCid } : {}), ...(identity.decimals !== undefined ? { decimals: identity.decimals } : {}), ...(identity.totalSupplyRaw ? { totalSupply: identity.totalSupplyRaw } : {}) };
          tracked = [entry, ...tracked].slice(0, 40);
          await trackToken(address, blockNumber);
          push({ id: `flap-${blockNumber}-${log.logIndex}`, type: "TOKEN_DETECTED", priority: "medium", timestamp: identity.createdAt ?? observedAt, blockNumber, txHash: log.transactionHash, contractAddress: address, token, source: src("flap-portal", logs.endpoint), data: { message: `Flap launch detected: ${token.symbol || address.slice(0, 10)}.`, creator, identity } });
          if (wallet() && creator.toLowerCase() === wallet()?.toLowerCase()) {
            selfToken = token; await trackToken(address, blockNumber, true);
            push({ id: `self-${blockNumber}-${log.logIndex}`, type: "SELF_TOKEN_DETECTED", priority: "high", initiator: "human", blockNumber, txHash: log.transactionHash, contractAddress: address, token, source: src("flap-portal", logs.endpoint), data: { message: "A token was launched from my wallet.", creator } });
          }
          if (analyses.length < 3) analyses.push(entry);
        } else {
          const tokenAddress = topicAddress(log.topics[1]) ?? wordAddress(log.data, 0);
          const known = tracked.find((item) => item.token.address.toLowerCase() === tokenAddress.toLowerCase());
          push({ id: `dex-${blockNumber}-${log.logIndex}`, type: "TOKEN_SNAPSHOT", priority: "medium", blockNumber, txHash: log.transactionHash, contractAddress: tokenAddress, ...(known ? { token: known.token } : {}), source: src("flap-portal", logs.endpoint), data: { message: `Flap token launched to DEX: ${known?.token.symbol || tokenAddress.slice(0, 10)}.`, kind: "LAUNCHED_TO_DEX" } });
          if (known) { known.launchedToDex = true; if (analyses.length < 4) analyses.push(known); }
        }
      }
      await indexHolders(from, to).catch((error: unknown) => { lastIndexError = error instanceof Error ? error.message.slice(0, 80) : "holder index error"; });
      lastBlock = to;
    } catch (error) {
      flapOk = false; lastIndexError = error instanceof Error ? error.message.slice(0, 80) : "log query failed";
      push({ id: `flap-rpc-${headBlock}`, type: "RPC_STATUS", priority: "medium", blockNumber: headBlock, source: src("bsc-rpc", head.endpoint), data: { message: "Flap log query unavailable; cursor held (no gap).", kind: "FLAP_LOGS_DEGRADED" } });
    }

    for (const item of analyses) events.push(...(await analyze(item, headBlock, limits, signer)));
    await saveHolders().catch(() => undefined);
  }

  for (const result of [...recoveredExecutionEvents.splice(0), ...drainExecutionEvents()]) events.push(executionEvent(result));
  const configuredWallet = wallet();
  if (configuredWallet) {
    const [balance, nonce] = await Promise.all([rpc<string>("eth_getBalance", [configuredWallet, "latest"]), rpc<string>("eth_getTransactionCount", [configuredWallet, "latest"])]);
    const nextBalance = weiHexToBnb(balance.value), nextNonce = hexToNumber(nonce.value);
    if (walletState.nonce !== undefined && nextNonce > walletState.nonce) push({ id: `wallet-out-${configuredWallet}-${nextNonce}`, type: "SYSTEM_STATUS", priority: "medium", blockNumber: headBlock, source: src("bsc-rpc", nonce.endpoint), data: { message: `Outbound wallet transaction observed (nonce ${nextNonce - 1}).`, kind: "WALLET_ACTIVITY" } });
    else if (walletState.balance !== undefined && nextBalance !== walletState.balance) push({ id: `wallet-bal-${headBlock}`, type: "SYSTEM_STATUS", priority: "medium", blockNumber: headBlock, source: src("bsc-rpc", balance.endpoint), data: { message: `Wallet balance changed: ${walletState.balance} → ${nextBalance} BNB.`, kind: "WALLET_ACTIVITY" } });
    walletState = { nonce: nextNonce, balance: nextBalance };
  }
  events.push(...await refreshOpenPositions(headBlock));
  for (const event of events) counters = countEvent(counters, event);
  await save().catch(() => undefined);

  lastPacket = await buildPacket({ headBlock, observedAt, latencyMs: head.latencyMs, endpoint: head.endpoint, events, flapOk, lag, blockAgeSeconds, usd, limits, signer });
  packetAt = Date.now();
  return lastPacket;
}

let currentMode: { effective: ExecutionMode; livePermitted: boolean } = { effective: "NO_SIGNER", livePermitted: false };
async function analyze(item: Tracked, headBlock: number, limits: ReturnType<typeof readHardLimits>, signer: ReturnType<typeof signerStatus>): Promise<NexaEvent[]> {
  const out: NexaEvent[] = []; const at = new Date().toISOString();
  try {
    if (!item.identity) item.identity = await resolveTokenIdentity({ address: item.token.address, creator: item.creator, createdBlock: item.createdBlock, detectedAt: at, ...(item.token.name ? { eventName: item.token.name } : {}), ...(item.token.symbol ? { eventSymbol: item.token.symbol } : {}), ...(item.metaCid ? { metaCid: item.metaCid } : {}) });
    if (item.decimals === undefined) { const meta = await erc20Meta(item.token.address); item.decimals = meta.decimals; item.totalSupply = meta.totalSupply; }
    const pair = await findPair(item.token.address);
    const quote: PriceQuote | null = pair ? await onchainPricing.quote(item.token.address, item.decimals ?? 18, item.totalSupply ? BigInt(item.totalSupply) : undefined) : null;
    const holders = holderMetrics(item.token.address, headBlock, item.totalSupply ? BigInt(item.totalSupply) : undefined);
    const decision = decide({ token: item.token, blockNumber: headBlock, observedAt: at, ...(quote ? { liquidityBnb: quote.liquidityBnb, priceBnb: quote.priceBnb, pricingSource: quote.source } : {}), ...(item.lastPriceBnb ? { previousPriceBnb: item.lastPriceBnb } : {}), holdersComplete: Boolean(holders?.complete), ...(holders?.holders !== undefined ? { holders: holders.holders } : {}), ...(holders?.holderDelta !== undefined ? { holderDelta: holders.holderDelta } : {}), ...(holders?.top10Share !== undefined ? { top10Share: holders.top10Share } : {}), ...(holders?.transferMomentum !== undefined ? { transferMomentum: holders.transferMomentum } : {}) }, limits);
    if (quote) item.lastPriceBnb = quote.priceBnb;
    await updateTokenMetrics(item.token.address, { ...(quote ? { priceBnb: quote.priceBnb, priceUsd: quote.priceUsd, marketCapUsd: quote.marketCapUsd, liquidityBnb: quote.liquidityBnb, pricing: { source: quote.source, observedAt: quote.observedAt, blockNumber: quote.blockNumber } } : {}), ...(holders?.complete ? { holders: holders.holders, concentration: holders.top10Share, holdersProvenance: { source: "transfer-index-from-creation", observedAt: at, blockNumber: holders.cursor, complete: true } } : {}) });
    item.lastDecisionAt = Date.now();
    const decisionId = `dec-${item.token.address.slice(2, 10)}-${headBlock}`;
    const source = src("nexa-agent");
    out.push({ id: `snap-${decisionId}`, type: "TOKEN_SNAPSHOT", priority: "low", timestamp: at, chainId: 56, blockNumber: headBlock, contractAddress: item.token.address, token: item.token, decisionId, source, data: { message: `Snapshot ${item.token.symbol || ""}: ${quote ? `${quote.liquidityBnb.toFixed(2)} BNB liquidity (Pancake v2)` : "no verified pair pricing"}; holders ${holders?.complete ? holders.holders : "indexing"}.`, pricing: quote ? { source: quote.source, pair: quote.pair, priceBnb: quote.priceBnb, liquidityBnb: quote.liquidityBnb, observedAt: quote.observedAt, blockNumber: quote.blockNumber } : null, holders } });
    out.push({ id: decisionId, type: "DECISION_CREATED", priority: decision.action === "ENTER" ? "high" : "medium", timestamp: at, chainId: 56, blockNumber: headBlock, contractAddress: item.token.address, token: item.token, decisionId, initiator: "autonomous", source, data: { message: decision.explanation, action: decision.action, reasonCodes: decision.reasonCodes, confidence: decision.confidence, priority: decision.priority, signals: decision.signals, metrics: decision.metrics } });
    if (decision.action === "ENTER") {
      const intent = { intentId: `int-${decisionId}`, decisionId, token: item.token, side: "BUY" as const, amountBnb: effectiveTradeSize(limits, riskMultiplier), slippageBps: limits.maxSlippageBps, chainId: 56 as const, protocolAddress: PANCAKE_V2_ROUTER as Hex, createdAt: at };
      out.push({ id: intent.intentId, type: "TRADE_INTENT_CREATED", priority: "high", timestamp: at, chainId: 56, contractAddress: item.token.address, token: item.token, decisionId, initiator: "autonomous", source, data: { message: `Trade intent: BUY ${intent.amountBnb} BNB of ${item.token.symbol || "token"} (${currentMode.effective}).`, amountBnb: intent.amountBnb, slippageBps: intent.slippageBps } });
      const from = signer.valid && signer.address?.toLowerCase() === wallet()?.toLowerCase() ? wallet() : undefined;
      for (const result of await runIntent({ intent, decidedAt: at, quote, mode: currentMode.effective, livePermitted: currentMode.livePermitted, ...(from ? { from } : {}), limits, riskMultiplier })) out.push(executionEvent(result));
    }
  } catch (error) {
    out.push({ id: `analysis-err-${item.token.address}-${headBlock}`, type: "TOKEN_ANALYSIS_UPDATED", priority: "low", timestamp: at, chainId: 56, token: item.token, source: src("nexa-agent"), data: { message: `Analysis incomplete: ${error instanceof Error ? error.message.slice(0, 60) : "RPC error"}.` } });
  }
  return out;
}
function executionEvent(result: ExecutionEvent): NexaEvent {
  const live = result.entry.status === "PENDING" || result.entry.status === "CONFIRMED" || result.entry.status === "REVERTED" || result.entry.status === "TIMEOUT";
  const identity = tracked.find((item) => item.token.address.toLowerCase() === result.entry.token.toLowerCase())?.identity;
  return { id: `${result.type.toLowerCase()}-${result.entry.intentId}-${result.entry.status}`, type: result.type, priority: result.type === "TRADE_BLOCKED" ? "high" : "critical", timestamp: new Date().toISOString(), chainId: 56, decisionId: result.entry.decisionId, contractAddress: result.entry.token, ...(identity ? { token: identity } : {}), ...(result.entry.txHash ? { txHash: result.entry.txHash } : {}), ...(result.entry.blockNumber ? { blockNumber: result.entry.blockNumber } : {}), initiator: live && result.type === "TRADE_EXECUTION_STARTED" ? "autonomous" : "system", source: src("nexa-agent"), data: { message: result.message, status: result.entry.status, mode: result.entry.mode, reasonCodes: result.entry.reasons, gasEstimate: result.entry.gasEstimate ?? null, dryRun: result.entry.status.startsWith("DRY_RUN"), ...(result.position ? { position: result.position } : {}) } };
}

async function refreshOpenPositions(headBlock: number): Promise<NexaEvent[]> {
  const before = await positionSnapshots(); const out: NexaEvent[] = [];
  for (const position of before.open.slice(0, 12)) {
    const decimals = position.token.decimals ?? 18, supply = position.token.totalSupplyRaw ? BigInt(position.token.totalSupplyRaw) : undefined;
    const quote = await onchainPricing.quote(position.token.address, decimals, supply).catch(() => null);
    const holders = holderMetrics(position.token.address, headBlock, supply);
    const updated = await updatePositionMarket(position.token.address, { ...(quote ? { priceBnb: quote.priceBnb, liquidityBnb: quote.liquidityBnb, pricing: { source: quote.source, observedAt: quote.observedAt, blockNumber: quote.blockNumber } } : { clearPricing: true }), ...(holders?.complete ? { holders: holders.holders, holdersProvenance: { source: "transfer-index-from-creation", observedAt: new Date().toISOString(), blockNumber: holders.cursor, complete: true } } : {}), decision: position.currentDecision ?? "HOLD", rationale: position.rationale ?? "Holding while verified position data remains within monitored conditions." });
    const oldValue = position.currentValueBnb, newValue = updated?.currentValueBnb;
    if (updated && newValue !== undefined && (oldValue === undefined || Math.abs(newValue - oldValue) / Math.max(oldValue, 1e-12) >= 0.005)) {
      const pct = updated.unrealizedPnlPct; const symbol = updated.token.symbol ? `$${updated.token.symbol}` : updated.token.address.slice(0, 10);
      const decisionId = updated.fills.at(-1)?.decisionId;
      out.push({ id: `position-${updated.positionId}-${headBlock}`, type: "POSITION_UPDATED", priority: "medium", timestamp: updated.updatedAt, chainId: 56, blockNumber: headBlock, contractAddress: updated.token.address, token: updated.token, ...(decisionId ? { decisionId } : {}), source: src("nexa-agent"), data: { message: `${symbol} · ${pct !== undefined ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% unrealized` : "PRICE UNAVAILABLE"} · ${updated.currentDecision ?? "HOLD"}`, position: updated } });
    }
  }
  return out;
}

async function buildPacket(input: { headBlock: number; observedAt: string; latencyMs: number; endpoint: string; events: NexaEvent[]; flapOk: boolean; lag: number; blockAgeSeconds: number; usd: { value: number; observedAt: string } | null; limits: ReturnType<typeof readHardLimits>; signer: ReturnType<typeof signerStatus> }): Promise<StreamPacket> {
  const { limits, signer } = input;
  const report = rpcReport(); const holders = holderIndexReport(input.headBlock); const stats = ledgerStats();
  const configuredWallet = wallet();
  const rpcHealthy = input.latencyMs <= 2_000 && input.blockAgeSeconds <= 20;
  const signerState: SystemSnapshot["signer"] = !signer.present ? "NOT_CONFIGURED" : !signer.valid ? "INVALID_FORMAT" : !configuredWallet ? "WALLET_REQUIRED" : signer.address?.toLowerCase() === configuredWallet.toLowerCase() ? "READY" : "WALLET_MISMATCH";
  const limitsConfigured = ["NEXA_MAX_TRADE_BNB", "NEXA_MAX_TOTAL_EXPOSURE_BNB", "NEXA_MAX_DAILY_LOSS_BNB"].every((name) => Boolean(process.env[name]));
  const viteLeak = Object.keys(process.env).some((name) => name.startsWith("VITE_") && /KEY|SECRET|PRIVATE|SEED|MNEMONIC/i.test(name) && !/PUBLISHABLE|ANON/i.test(name));
  const sim = stats.lastSimulation;
  const checks: ReadinessCheck[] = [
    { id: "CHAIN_ID_56", ok: chainIdVerified === true, detail: chainIdVerified ? "eth_chainId = 56" : "RPC chain is not 56" },
    { id: "SIGNER_PRESENT", ok: signer.valid, detail: signer.present ? (signer.valid ? `${signer.secretName} present (server-only)` : `${signer.secretName} has invalid format (expected 32-byte hex)`) : "Set secret NEXA_PRIVATE_KEY" },
    { id: "SIGNER_MATCHES_WALLET", ok: signerState === "READY", detail: signerState === "WALLET_REQUIRED" ? `Set NEXA_WALLET_ADDRESS=${signer.address ?? "<signer address>"}` : signerState === "WALLET_MISMATCH" ? "Signer address ≠ NEXA_WALLET_ADDRESS" : signerState === "READY" ? "Signer address matches NEXA_WALLET_ADDRESS" : "Signer unavailable" },
    { id: "RPC_HEALTHY_FRESH", ok: rpcHealthy, detail: `${input.latencyMs} ms · head age ${input.blockAgeSeconds}s` },
    { id: "FLAP_CONTRACTS_VERIFIED", ok: Boolean(portalHasCode) && input.flapOk, detail: portalHasCode ? (input.flapOk ? "Portal bytecode present, TokenCreated/LaunchedToDEX logs indexed" : "Portal logs unavailable — set BSC_LOG_RPC_URLS") : "Portal bytecode missing" },
    { id: "PRICING_FRESH", ok: bnbUsdFresh(), detail: input.usd ? `BNB/USD ${input.usd.value.toFixed(2)} from Pancake v2 reserves` : "Pancake v2 reserves unavailable" },
    { id: "POLICY_ENGINE_ENABLED", ok: true, detail: "Policy Engine runs before every simulation/signature" },
    { id: "EMERGENCY_STOP_DISABLED", ok: !limits.emergencyStop, detail: limits.emergencyStop ? "Set NEXA_EMERGENCY_STOP=false to allow LIVE modes" : "Emergency stop off" },
    { id: "EXECUTION_LIMITS_CONFIGURED", ok: limitsConfigured, detail: limitsConfigured ? "Hard limits set explicitly" : "Set NEXA_MAX_TRADE_BNB, NEXA_MAX_TOTAL_EXPOSURE_BNB, NEXA_MAX_DAILY_LOSS_BNB" },
    { id: "NO_SECRET_EXPOSURE", ok: !viteLeak, detail: viteLeak ? "A VITE_* variable looks like a secret — remove and rotate" : "No secret-like VITE_* variables; signer read server-side only" },
    { id: "SIMULATION_PASSES", ok: sim?.status === "DRY_RUN_OK" || sim?.status === "CONFIRMED", detail: sim ? `Last: ${sim.status}${sim.reasons[0] ? ` (${sim.reasons[0]})` : ""}` : "No real ENTER decision has reached simulation yet" },
  ];
  const mode = executionModeFor(signer, checks);
  currentMode = mode;
  const protection = evaluateProtection({ chainId: chainIdVerified === false ? 0 : 56, rpcHealthy, blockAgeSeconds: input.blockAgeSeconds, pricingVerified: bnbUsdFresh(), signerConnected: mode.livePermitted, emergencyStop: limits.emergencyStop, dailyLossBnb: 0, totalExposureBnb: stats.totalExposureBnb, limits, unexpectedExecutionState: stats.pending });
  const integ = (state: IntegrationStatus["state"], detail: string, missing?: string[]): IntegrationStatus => ({ state, detail, ...(missing ? { missing } : {}) });
  const integrations: Record<IntegrationName, IntegrationStatus> = {
    RPC: integ(rpcHealthy ? "ok" : "degraded", `${input.endpoint} · ${report.endpoints.filter((e) => e.healthy).length}/${report.endpoints.length} healthy · getLogs ${report.logsAvailable ? "OK" : "UNAVAILABLE"}`, report.customHead ? undefined : ["BSC_RPC_URLS (recommended: private endpoint)"]),
    INDEXER: integ(input.flapOk ? (input.lag > 0 ? "degraded" : "ok") : "offline", input.flapOk ? (input.lag > 0 ? `Catching up · ${input.lag} blocks behind` : `Synced to #${(lastBlock ?? 0).toLocaleString()}`) : `Cursor held at #${(lastBlock ?? 0).toLocaleString()} · ${lastIndexError ?? ""}`, report.dedicatedLogs ? undefined : ["BSC_LOG_RPC_URLS (recommended)"]),
    FLAP: integ(input.flapOk && portalHasCode ? "ok" : "degraded", `Portal ${FLAP_PORTAL_ADDRESS.slice(0, 10)}… · TokenCreated + LaunchedToDEX · bonding-curve quotes need FLAP_PORTAL_QUOTE_ABI`, ["FLAP_PORTAL_QUOTE_ABI (bonding-curve pricing/trading)"]),
    PRICING: integ(bnbUsdFresh() ? "ok" : "degraded", input.usd ? `BNB $${input.usd.value.toFixed(2)} · Pancake v2 reserves · ${input.usd.observedAt.slice(11, 19)}Z` : "Pancake v2 reserves unavailable"),
    HOLDERS: integ(holders.tracked ? (holders.behind.length ? "degraded" : "ok") : "offline", `${holders.complete}/${holders.tracked} tokens fully indexed from creation${holders.behind.length ? ` · ${holders.behind.length} backfilling` : ""}`),
    WALLET: configuredWallet ? integ("ok", `${configuredWallet.slice(0, 8)}…${configuredWallet.slice(-6)} · ${walletState.balance ?? "—"} BNB`) : integ("config_required", "Public agent wallet not configured", ["NEXA_WALLET_ADDRESS"]),
    SIGNER: integ(signerState === "READY" ? "ok" : signer.present ? "config_required" : "config_required", signerState.replaceAll("_", " "), signerState === "NOT_CONFIGURED" ? ["NEXA_PRIVATE_KEY (server secret)"] : signerState === "WALLET_REQUIRED" ? ["NEXA_WALLET_ADDRESS"] : undefined),
    EXECUTION: integ(mode.livePermitted ? "ok" : "degraded", `${mode.effective}${mode.requested !== mode.effective ? ` (requested ${mode.requested})` : ""} · ${checks.filter((c) => c.ok).length}/${checks.length} ready`),
  };
  const events = input.events.length ? input.events : [{ id: `rpc-${input.headBlock}-${Math.floor(Date.now() / 15000)}`, type: "RPC_STATUS" as const, priority: "low" as const, timestamp: input.observedAt, chainId: 56 as const, blockNumber: input.headBlock, source: src("bsc-rpc", input.endpoint), data: { message: "BSC RPC synchronized.", latencyMs: input.latencyMs } }];
  const [catalog, positionData] = await Promise.all([tokenIdentityCatalog(), positionSnapshots()]);
  const selfIdentity = selfToken ? catalog.find((item) => item.address.toLowerCase() === selfToken?.address.toLowerCase()) : undefined;
  const snapshot: SystemSnapshot = {
    status: input.flapOk ? "live" : "degraded", chainId: 56, chainName: "BNB Smart Chain", rpcStatus: rpcHealthy ? "healthy" : "slow", lastBlock: input.headBlock, blockObservedAt: input.observedAt, latencyMs: input.latencyMs,
    eventRate: input.events.length, queueDepth: input.lag, ...(configuredWallet ? { walletAddress: configuredWallet } : {}), ...(walletState.balance && configuredWallet ? { walletBalanceBnb: walletState.balance } : {}),
    flapPortal: FLAP_PORTAL_ADDRESS, flapConfigured: true, walletConfigured: Boolean(configuredWallet), executionMode: mode.effective, requestedExecutionMode: mode.requested,
    modules: { SCOUT: input.flapOk ? "ready" : "offline", ANALYST: holders.tracked ? "ready" : "waiting", BRAIN: "ready", TRADER: mode.effective === "NO_SIGNER" ? "waiting" : "ready", MEMORY: "ready", WALLET: configuredWallet ? "ready" : "waiting", FLAP: input.flapOk ? "ready" : "offline" },
    protection, hardLimits: limits, riskMultiplier, counters, signer: signerState, ...(signer.address ? { signerAddress: signer.address } : {}), social: "SOCIAL_PUBLISHING_DISABLED",
    integrations, readiness: checks, ...(input.usd ? { bnbUsd: input.usd.value, pricingObservedAt: input.usd.observedAt } : {}),
    detectedTokens: catalog, ...(selfIdentity ? { selfToken: selfIdentity } : {}), openPositions: positionData.open, closedPositions: positionData.closed,
    dryRunIntents: dryRunLedger().map((entry) => ({ intentId: entry.intentId, decisionId: entry.decisionId, token: tracked.find((item) => item.token.address.toLowerCase() === entry.token.toLowerCase())?.token ?? { address: entry.token }, amountBnb: entry.amountBnb, status: entry.status === "DRY_RUN_OK" ? "DRY_RUN_OK" : "DRY_RUN_FAILED", createdAt: entry.createdAt, reasons: entry.reasons })),
  };
  return { snapshot, events: events.slice(-40) };
}
