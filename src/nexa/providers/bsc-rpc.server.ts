/**
 * Server-only BSC JSON-RPC pool with health scoring, failover, backoff and eth_getLogs capability detection.
 * BSC_RPC_URLS = head/read endpoints (primary first). BSC_LOG_RPC_URLS = dedicated log-capable endpoints.
 */
const DEFAULT_HEAD = ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com", "https://1rpc.io/bnb"];
const DEFAULT_LOGS = ["https://bsc-rpc.publicnode.com", "https://1rpc.io/bnb"];
const PROBE_ADDRESS = "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0";
type RpcResponse<T> = { result?: T; error?: { code: number; message: string } };
interface Health { score: number; failures: number; lastOkAt?: number; latencyMs?: number; logs?: boolean; logsProbedAt?: number; lastError?: string }
const health = new Map<string, Health>();
let requestId = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const list = (name: string) => process.env[name]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
const h = (url: string) => { let entry = health.get(url); if (!entry) { entry = { score: 100, failures: 0 }; health.set(url, entry); } return entry; };
const host = (url: string) => { try { return new URL(url).hostname; } catch { return "invalid-url"; } };

function headPool() { const configured = list("BSC_RPC_URLS"); return configured.length ? configured : DEFAULT_HEAD; }
function logPool() {
  const dedicated = list("BSC_LOG_RPC_URLS");
  if (dedicated.length) return dedicated;
  return [...new Set([...headPool(), ...DEFAULT_LOGS])].filter((url) => h(url).logs !== false);
}
const ranked = (urls: string[]) => [...urls].sort((a, b) => h(b).score - h(a).score);

async function call<T>(url: string, method: string, params: unknown[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const started = Date.now();
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }), signal: controller.signal });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const payload = (await response.json()) as RpcResponse<T>;
    if (payload.error) throw new Error(`${payload.error.code}: ${payload.error.message}`);
    if (payload.result === undefined) throw new Error("RPC result missing");
    return { value: payload.result, latencyMs: Date.now() - started };
  } finally { clearTimeout(timeout); }
}

export interface RpcResult<T> { value: T; latencyMs: number; endpoint: string }
/** Calls go through ranked endpoints; logs calls only use endpoints that passed the eth_getLogs probe. */
export async function rpc<T>(method: string, params: unknown[] = [], options: { kind?: "head" | "logs" } = {}): Promise<RpcResult<T>> {
  const kind = options.kind ?? (method === "eth_getLogs" ? "logs" : "head");
  if (kind === "logs") await probeLogs();
  const urls = ranked(kind === "logs" ? logPool().filter((url) => h(url).logs !== false) : headPool());
  if (!urls.length) throw new Error("NO_LOG_CAPABLE_RPC");
  let lastError: unknown;
  for (let attempt = 0; attempt < Math.min(urls.length + 1, 4); attempt += 1) {
    const url = urls[attempt % urls.length] ?? "";
    const entry = h(url);
    try {
      const result = await call<T>(url, method, params);
      entry.score = Math.min(100, entry.score + 5); entry.failures = 0; entry.lastOkAt = Date.now(); entry.latencyMs = result.latencyMs; delete entry.lastError;
      return { ...result, endpoint: host(url) };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      entry.failures += 1; entry.score = Math.max(0, entry.score - 25); entry.lastError = message.slice(0, 120);
      if (method === "eth_getLogs" && /limit|-32005|range|too many/i.test(message)) entry.logsProbedAt = 0; // re-probe soon instead of permanent disable
      await sleep(200 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("BSC RPC unavailable");
}

/** Probes each candidate once per 10 minutes with a cheap latest-block getLogs. */
export async function probeLogs() {
  const candidates = list("BSC_LOG_RPC_URLS").length ? list("BSC_LOG_RPC_URLS") : [...new Set([...headPool(), ...DEFAULT_LOGS])];
  await Promise.all(candidates.filter((url) => !h(url).logsProbedAt || Date.now() - (h(url).logsProbedAt ?? 0) > 600_000).map(async (url) => {
    const entry = h(url); entry.logsProbedAt = Date.now();
    try { await call(url, "eth_getLogs", [{ fromBlock: "latest", toBlock: "latest", address: PROBE_ADDRESS }]); entry.logs = true; }
    catch (error) { entry.logs = false; entry.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 120); }
  }));
}

export function rpcReport() {
  const urls = [...new Set([...headPool(), ...logPool(), ...list("BSC_LOG_RPC_URLS")])];
  const endpoints = urls.map((url) => { const entry = h(url); return { host: host(url), score: entry.score, logs: entry.logs ?? null, latencyMs: entry.latencyMs ?? null, healthy: entry.failures < 3 }; });
  return { endpoints, logsAvailable: endpoints.some((entry) => entry.logs === true), dedicatedLogs: list("BSC_LOG_RPC_URLS").length > 0, customHead: list("BSC_RPC_URLS").length > 0 };
}

export const hexToNumber = (hex: string) => Number.parseInt(hex, 16);
export const weiHexToBnb = (hex: string) => (Number(BigInt(hex)) / 1e18).toFixed(5);
