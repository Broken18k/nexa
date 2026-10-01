import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ExecutionMode, HardLimits, PositionSnapshot, TradeIntent } from "../types";
import { rpc, hexToNumber } from "../providers/bsc-rpc.server";
import { padAddress, padUint, selector, topicAddress, TRANSFER_TOPIC, type Hex } from "../providers/eth.server";
import { PANCAKE_V2_ROUTER, WBNB, type PriceQuote } from "../providers/pricing.server";
import { FLAP_PORTAL_ADDRESS } from "../config";
import { PolicyEngine } from "./modules";
import { signLegacyTransaction } from "./signer.server";
import { applyConfirmedFill } from "./positions.server";
import { tokenIdentityByAddress } from "../providers/token-metadata.server";

export type LedgerStatus = "BLOCKED" | "DRY_RUN_OK" | "DRY_RUN_FAILED" | "PENDING" | "CONFIRMED" | "REVERTED" | "TIMEOUT" | "FAILED";
export interface LedgerEntry {
  intentId: string; decisionId: string; token: Hex; side: "BUY" | "SELL"; amountBnb: number; mode: ExecutionMode; status: LedgerStatus; reasons: string[];
  gasEstimate?: string; gasPriceWei?: string; nonce?: number; txHash?: Hex; blockNumber?: number; createdAt: string; updatedAt: string;
}
let ledger: LedgerEntry[] = [];
let loaded = false;
let nextNonce: number | undefined;
const ledgerPath = () => resolve(process.env["NEXA_LEDGER_PATH"]?.trim() || ".data/nexa-ledger.json");
export async function loadLedger() { if (loaded) return; loaded = true; try { ledger = (JSON.parse(await readFile(ledgerPath(), "utf8")) as { entries: LedgerEntry[] }).entries ?? []; } catch { ledger = []; } }
async function saveLedger() { const file = ledgerPath(); await mkdir(dirname(file), { recursive: true }); await writeFile(`${file}.tmp`, JSON.stringify({ entries: ledger.slice(-500) })); await rename(`${file}.tmp`, file); }
async function record(entry: LedgerEntry) { const index = ledger.findIndex((item) => item.intentId === entry.intentId); if (index >= 0) ledger[index] = entry; else ledger.push(entry); await saveLedger().catch(() => undefined); return entry; }

export function ledgerStats() {
  const live = ledger.filter((entry) => entry.status === "CONFIRMED" && entry.side === "BUY");
  const lastLive = [...ledger].reverse().find((entry) => entry.status === "CONFIRMED" || entry.status === "PENDING");
  return {
    totalExposureBnb: live.reduce((sum, entry) => sum + entry.amountBnb, 0),
    exposureFor: (token: string) => live.filter((entry) => entry.token.toLowerCase() === token.toLowerCase()).reduce((sum, entry) => sum + entry.amountBnb, 0),
    lastTradeAt: lastLive?.createdAt, pending: ledger.some((entry) => entry.status === "PENDING" || entry.status === "TIMEOUT"),
    lastSimulation: [...ledger].reverse().find((entry) => entry.status === "DRY_RUN_OK" || entry.status === "DRY_RUN_FAILED" || entry.status === "CONFIRMED"),
    seen: new Set(ledger.flatMap((entry) => [entry.intentId, entry.decisionId])),
  };
}

const clampEnv = (name: string, fallback: number, ceiling: number) => { const value = Number(process.env[name]); return Number.isFinite(value) && value > 0 ? Math.min(value, ceiling) : fallback; };
export const gasLimits = () => ({ maxGas: BigInt(Math.floor(clampEnv("NEXA_MAX_GAS_LIMIT", 400_000, 1_500_000))), maxGasPriceWei: BigInt(Math.floor(clampEnv("NEXA_MAX_GAS_PRICE_GWEI", 3, 20) * 1e9)), confirmations: clampEnv("NEXA_CONFIRMATIONS", 3, 20), timeoutSeconds: clampEnv("NEXA_TX_TIMEOUT_SECONDS", 90, 600) });

const SWAP = selector("swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)");
function buyCalldata(token: Hex, minOut: bigint, recipient: Hex, deadline: bigint): Hex {
  return `${SWAP}${padUint(minOut)}${padUint(128n)}${padAddress(recipient)}${padUint(deadline)}${padUint(2n)}${padAddress(WBNB)}${padAddress(token)}` as Hex;
}
const expectedOut = (amountIn: bigint, reserveIn: bigint, reserveOut: bigint) => (amountIn * 9975n * reserveOut) / (reserveIn * 10_000n + amountIn * 9975n);

export type ExecutionEvent = { type: "TRADE_BLOCKED" | "TRADE_EXECUTION_STARTED" | "TRADE_EXECUTED" | "TX_CONFIRMED" | "TX_FAILED" | "POSITION_OPENED" | "POSITION_UPDATED" | "POSITION_CLOSED"; entry: LedgerEntry; message: string; position?: PositionSnapshot };
const receiptQueue: ExecutionEvent[] = [];
export const drainExecutionEvents = () => receiptQueue.splice(0, receiptQueue.length);

/** BRAIN → TradeIntent → Policy → simulation → (DRY_RUN receipt | sign → broadcast → receipt). Refuses on any failed precondition. */
export async function runIntent(args: { intent: TradeIntent; decidedAt: string; quote: PriceQuote | null; mode: ExecutionMode; livePermitted: boolean; from?: Hex; limits: HardLimits; riskMultiplier: number }): Promise<ExecutionEvent[]> {
  await loadLedger();
  const { intent, limits, quote } = args;
  const now = new Date().toISOString();
  const base: LedgerEntry = { intentId: intent.intentId, decisionId: intent.decisionId, token: intent.token.address, side: intent.side, amountBnb: intent.amountBnb, mode: args.mode, status: "BLOCKED", reasons: [], createdAt: now, updatedAt: now };
  const block = async (reasons: string[], persist = true): Promise<ExecutionEvent[]> => { const entry = { ...base, reasons }; if (persist) await record(entry); return [{ type: "TRADE_BLOCKED", entry, message: `Trade blocked: ${reasons.join(", ")}.` }]; };
  const stats = ledgerStats();
  if (stats.seen.has(intent.intentId) || stats.seen.has(intent.decisionId)) return block(["DUPLICATE_INTENT"], false);
  if (Date.now() - Date.parse(args.decidedAt) > limits.maxSnapshotAgeSeconds * 1000) return block(["STALE_DECISION_SNAPSHOT"]);
  if (!quote || Date.now() - Date.parse(quote.observedAt) > 60_000) return block(["PRICING_UNVERIFIED"]);
  const policy = new PolicyEngine({ ...limits, emergencyStop: args.livePermitted ? limits.emergencyStop : false, maxTradeSizeBnb: Math.min(limits.maxTradeSizeBnb, limits.maxTradeSizeBnb * args.riskMultiplier), allowedChainId: 56, allowedProtocols: [PANCAKE_V2_ROUTER, FLAP_PORTAL_ADDRESS] })
    .validate(intent, { totalExposureBnb: stats.totalExposureBnb, tokenExposureBnb: stats.exposureFor(intent.token.address), dailyLossBnb: 0, liquidityBnb: quote.liquidityBnb, ...(stats.lastTradeAt ? { lastTradeAt: stats.lastTradeAt } : {}), seenIntentIds: stats.seen });
  if (!policy.allowed) return block(policy.reasons);
  if (stats.pending) return block(["PENDING_TRANSACTION_UNRESOLVED"]);
  if (!args.from) return block(["SIGNER_UNAVAILABLE"]);

  const amountWei = BigInt(Math.round(intent.amountBnb * 1e18));
  const minOut = (expectedOut(amountWei, quote.reserveWbnb, quote.reserveToken) * BigInt(10_000 - intent.slippageBps)) / 10_000n;
  const data = buyCalldata(intent.token.address, minOut, args.from, BigInt(Math.floor(Date.now() / 1000) + 120));
  const gas = gasLimits();
  let gasEstimate: bigint, gasPrice: bigint;
  try {
    const [estimate, price] = await Promise.all([rpc<string>("eth_estimateGas", [{ from: args.from, to: PANCAKE_V2_ROUTER, value: `0x${amountWei.toString(16)}`, data }]), rpc<string>("eth_gasPrice")]);
    gasEstimate = BigInt(estimate.value); gasPrice = BigInt(price.value);
  } catch (error) {
    const entry = await record({ ...base, status: args.mode === "DRY_RUN" || !args.livePermitted ? "DRY_RUN_FAILED" : "FAILED", reasons: ["SIMULATION_FAILED", (error instanceof Error ? error.message : "estimateGas failed").slice(0, 100)] });
    return [{ type: "TRADE_BLOCKED", entry, message: `Simulation failed: ${entry.reasons[1]}.` }];
  }
  if (gasEstimate > gas.maxGas || gasPrice > gas.maxGasPriceWei) return block(["GAS_CEILING"]);
  const simulated = { ...base, gasEstimate: gasEstimate.toString(), gasPriceWei: gasPrice.toString() };
  if (!args.livePermitted || (args.mode !== "LIVE_LIMITED" && args.mode !== "LIVE_AUTONOMOUS")) {
    const entry = await record({ ...simulated, status: "DRY_RUN_OK", reasons: ["DRY_RUN_NOT_BROADCAST"] });
    return [{ type: "TRADE_EXECUTION_STARTED", entry, message: `DRY RUN: simulation passed (gas ${gasEstimate}). Not broadcast.` }];
  }
  try {
    const chainNonce = hexToNumber((await rpc<string>("eth_getTransactionCount", [args.from, "pending"])).value);
    const nonce = Math.max(chainNonce, nextNonce ?? 0); nextNonce = nonce + 1;
    const raw = signLegacyTransaction({ nonce: BigInt(nonce), gasPrice, gas: (gasEstimate * 12n) / 10n, to: PANCAKE_V2_ROUTER, value: amountWei, data });
    const sent = await rpc<Hex>("eth_sendRawTransaction", [raw]);
    const entry = await record({ ...simulated, nonce, status: "PENDING", txHash: sent.value, reasons: [] });
    void watchReceipt(entry);
    return [{ type: "TRADE_EXECUTION_STARTED", entry, message: "Autonomous execution started." }, { type: "TRADE_EXECUTED", entry, message: "Transaction broadcast; awaiting receipt." }];
  } catch (error) {
    nextNonce = undefined;
    const entry = await record({ ...simulated, status: "FAILED", reasons: ["BROADCAST_FAILED", (error instanceof Error ? error.message : "").slice(0, 100)] });
    return [{ type: "TRADE_BLOCKED", entry, message: "Broadcast failed; nonce re-synced." }];
  }
}

/** Waits for receipt + confirmations. TIMEOUT keeps the execution lock: no automatic replacement; operator review required. */
async function watchReceipt(entry: LedgerEntry) {
  const gas = gasLimits(); const deadline = Date.now() + gas.timeoutSeconds * 1000;
  while (Date.now() < deadline && entry.txHash) {
    try {
      const receipt = (await rpc<RpcReceipt | null>("eth_getTransactionReceipt", [entry.txHash])).value;
      if (receipt) {
        const head = hexToNumber((await rpc<string>("eth_blockNumber")).value);
        if (head - hexToNumber(receipt.blockNumber) + 1 >= gas.confirmations) {
          const final = await record({ ...entry, status: receipt.status === "0x1" ? "CONFIRMED" : "REVERTED", blockNumber: hexToNumber(receipt.blockNumber), updatedAt: new Date().toISOString() });
          receiptQueue.push({ type: final.status === "CONFIRMED" ? "TX_CONFIRMED" : "TX_FAILED", entry: final, message: final.status === "CONFIRMED" ? `Transaction confirmed in block ${final.blockNumber}.` : "Transaction reverted onchain." });
          if (final.status === "CONFIRMED") {
            const positionEvent = await accountConfirmedEntry(final, receipt).catch(() => null);
            if (positionEvent) receiptQueue.push(positionEvent);
          }
          return;
        }
      }
    } catch { /* retry */ }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 3_000));
  }
  const timedOut = await record({ ...entry, status: "TIMEOUT", reasons: ["RECEIPT_TIMEOUT_OPERATOR_REVIEW"], updatedAt: new Date().toISOString() });
  receiptQueue.push({ type: "TX_FAILED", entry: timedOut, message: "Receipt timeout; execution locked pending operator review." });
}

interface RpcReceipt { status: string; blockNumber: string; gasUsed?: string; effectiveGasPrice?: string; logs?: { address: Hex; topics: string[]; data: string; logIndex: string }[] }
function receivedQuantity(receipt: RpcReceipt, token: string, walletAddress: string, side: "BUY" | "SELL") {
  return (receipt.logs ?? []).filter((log) => log.address.toLowerCase() === token.toLowerCase() && log.topics[0]?.toLowerCase() === TRANSFER_TOPIC && (side === "BUY" ? topicAddress(log.topics[2])?.toLowerCase() === walletAddress.toLowerCase() : topicAddress(log.topics[1])?.toLowerCase() === walletAddress.toLowerCase())).reduce((sum, log) => sum + BigInt(log.data === "0x" ? "0" : log.data), 0n);
}
async function accountConfirmedEntry(entry: LedgerEntry, receiptInput?: RpcReceipt): Promise<ExecutionEvent | null> {
  if (!entry.txHash || (entry.mode !== "LIVE_LIMITED" && entry.mode !== "LIVE_AUTONOMOUS") || entry.status !== "CONFIRMED") return null;
  const walletAddress = process.env["NEXA_WALLET_ADDRESS"]?.trim(); if (!walletAddress) return null;
  const receipt = receiptInput ?? (await rpc<RpcReceipt | null>("eth_getTransactionReceipt", [entry.txHash])).value; if (!receipt || receipt.status !== "0x1") return null;
  const quantity = receivedQuantity(receipt, entry.token, walletAddress, entry.side); if (quantity <= 0n) return null;
  const identity = await tokenIdentityByAddress(entry.token); if (!identity) return null;
  const blockNumber = hexToNumber(receipt.blockNumber);
  const [block, transaction] = await Promise.all([rpc<{ timestamp: string }>("eth_getBlockByNumber", [receipt.blockNumber, false]), rpc<{ value: string } | null>("eth_getTransactionByHash", [entry.txHash])]);
  const gasBnb = receipt.gasUsed && receipt.effectiveGasPrice ? Number(BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)) / 1e18 : undefined;
  const actualBnbAmount = entry.side === "BUY" && transaction.value?.value ? Number(BigInt(transaction.value.value)) / 1e18 : undefined;
  const applied = await applyConfirmedFill({ fillKey: `${entry.txHash}:${entry.side}`, side: entry.side, txHash: entry.txHash, blockNumber, timestamp: new Date(hexToNumber(block.value.timestamp) * 1000).toISOString(), quantityRaw: quantity.toString(), ...(actualBnbAmount !== undefined ? { bnbAmount: actualBnbAmount } : {}), ...(gasBnb !== undefined ? { gasBnb } : {}), decisionId: entry.decisionId, mode: entry.mode, receiptConfirmed: true, token: identity });
  if (!applied) return null;
  const symbol = identity.symbol ? `$${identity.symbol}` : identity.address.slice(0, 10);
  const message = applied.eventType === "POSITION_OPENED" ? `POSITION OPENED · ${symbol} · ${actualBnbAmount?.toFixed(4) ?? "BNB AMOUNT UNAVAILABLE"} BNB · TX CONFIRMED` : applied.eventType === "POSITION_CLOSED" ? `POSITION CLOSED · ${symbol}${applied.position.realizedPnlBnb !== undefined ? ` · ${applied.position.realizedPnlBnb >= 0 ? "+" : ""}${applied.position.realizedPnlBnb.toFixed(4)} BNB realized` : " · realized PnL unavailable"}` : `${symbol} · POSITION UPDATED`;
  return { type: applied.eventType, entry, message, position: applied.position };
}

/** Replays confirmed ledger rows through receipt verification after a restart. Idempotent by persisted fill key. */
export async function reconcileConfirmedPositions() {
  await loadLedger(); const recovered: ExecutionEvent[] = [];
  for (const entry of ledger.filter((item) => item.status === "CONFIRMED" && item.txHash).slice(-100)) { const event = await accountConfirmedEntry(entry).catch(() => null); if (event) recovered.push(event); }
  return recovered;
}
export function dryRunLedger() { return ledger.filter((entry) => entry.status === "DRY_RUN_OK" || entry.status === "DRY_RUN_FAILED").slice(-12).reverse(); }
