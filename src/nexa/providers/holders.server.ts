import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { rpc, hexToNumber } from "./bsc-rpc.server";
import { topicAddress, TRANSFER_TOPIC, ZERO_ADDRESS, type Hex } from "./eth.server";

const MAX_TRACKED = 30;
const BACKFILL_CHUNK = 2_000;
interface TokenIndex { address: Hex; startBlock: number; cursor: number; balances: Record<string, string>; transfers: number; recentTransfers: number[]; holderHistory: number[] }
let tokens: TokenIndex[] = [];
let loaded = false;
const path = () => resolve(process.env["NEXA_HOLDER_INDEX_PATH"]?.trim() || ".data/nexa-holders.json");

async function load() {
  if (loaded) return; loaded = true;
  try { tokens = (JSON.parse(await readFile(path(), "utf8")) as { tokens: TokenIndex[] }).tokens ?? []; } catch { tokens = []; }
}
export async function saveHolders() {
  const file = path(); await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify({ tokens })); await rename(`${file}.tmp`, file);
}

/** Starts indexing a token from its creation block. Oldest non-pinned tokens are evicted at capacity. */
export async function trackToken(address: Hex, startBlock: number, pinned = false) {
  await load();
  if (tokens.some((token) => token.address.toLowerCase() === address.toLowerCase())) return;
  tokens.unshift({ address, startBlock, cursor: startBlock - 1, balances: {}, transfers: 0, recentTransfers: [], holderHistory: [] });
  if (tokens.length > MAX_TRACKED) tokens = tokens.filter((token, index) => index < MAX_TRACKED || (pinned && token.address === address));
}

function apply(index: TokenIndex, from: string, to: string, value: bigint) {
  if (from !== ZERO_ADDRESS) { const next = BigInt(index.balances[from] ?? "0") - value; if (next > 0n) index.balances[from] = next.toString(); else delete index.balances[from]; }
  if (to !== ZERO_ADDRESS) index.balances[to] = (BigInt(index.balances[to] ?? "0") + value).toString();
  index.transfers += 1;
}

/** Index Transfer logs for caught-up tokens in one batched query, then backfill one lagging token per tick. */
export async function indexHolders(from: number, to: number) {
  await load();
  const live = tokens.filter((token) => token.cursor >= from - 1);
  if (live.length) {
    const logs = await rpc<{ address: string; topics: string[]; data: string; blockNumber: string }[]>("eth_getLogs", [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, address: live.map((token) => token.address), topics: [TRANSFER_TOPIC] }]);
    for (const token of live) {
      const own = logs.value.filter((log) => log.address.toLowerCase() === token.address.toLowerCase() && hexToNumber(log.blockNumber) > token.cursor);
      for (const log of own) apply(token, topicAddress(log.topics[1]) ?? ZERO_ADDRESS, topicAddress(log.topics[2]) ?? ZERO_ADDRESS, BigInt(log.data === "0x" ? "0" : log.data));
      token.recentTransfers = [...token.recentTransfers, own.length].slice(-20);
      token.holderHistory = [...token.holderHistory, Object.keys(token.balances).length].slice(-20);
      token.cursor = to;
    }
  }
  const lagging = tokens.find((token) => token.cursor < from - 1);
  if (lagging) {
    const end = Math.min(lagging.cursor + BACKFILL_CHUNK, from - 1);
    const logs = await rpc<{ topics: string[]; data: string }[]>("eth_getLogs", [{ fromBlock: `0x${(lagging.cursor + 1).toString(16)}`, toBlock: `0x${end.toString(16)}`, address: lagging.address, topics: [TRANSFER_TOPIC] }]);
    for (const log of logs.value) apply(lagging, topicAddress(log.topics[1]) ?? ZERO_ADDRESS, topicAddress(log.topics[2]) ?? ZERO_ADDRESS, BigInt(log.data === "0x" ? "0" : log.data));
    lagging.cursor = end;
  }
}

export interface HolderMetrics { complete: boolean; startBlock: number; cursor: number; holders?: number; top10Share?: number; holderDelta?: number; transferMomentum?: number; transfers: number }
/** Holder count / concentration only when the index covers creation → now. Never inferred from transfer counts. */
export function holderMetrics(address: string, head: number, totalSupply?: bigint): HolderMetrics | null {
  const token = tokens.find((item) => item.address.toLowerCase() === address.toLowerCase());
  if (!token) return null;
  const complete = token.cursor >= head - 50;
  const base = { complete, startBlock: token.startBlock, cursor: token.cursor, transfers: token.transfers };
  if (!complete) return base;
  const balances = Object.values(token.balances).map((value) => BigInt(value)).sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
  const supply = totalSupply ?? balances.reduce((sum, value) => sum + value, 0n);
  const top10 = balances.slice(0, 10).reduce((sum, value) => sum + value, 0n);
  const history = token.holderHistory; const recent = token.recentTransfers;
  const late = recent.slice(-5).reduce((a, b) => a + b, 0), early = recent.slice(-10, -5).reduce((a, b) => a + b, 0);
  return { ...base, holders: balances.length, ...(supply > 0n ? { top10Share: Number((top10 * 10_000n) / supply) / 10_000 } : {}), ...(history.length > 5 ? { holderDelta: (history.at(-1) ?? 0) - (history.at(-6) ?? 0) } : {}), ...(recent.length >= 10 ? { transferMomentum: early ? late / early : late } : {}) };
}
export function holderIndexReport(head: number) {
  return { tracked: tokens.length, complete: tokens.filter((token) => token.cursor >= head - 50).length, behind: tokens.filter((token) => token.cursor < head - 50).map((token) => ({ address: token.address, remainingBlocks: head - token.cursor })) };
}
