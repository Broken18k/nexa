import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { TokenIdentity } from "../types";
import { rpc } from "./bsc-rpc.server";
import { selector, wordBig, type Hex } from "./eth.server";

interface CachedIdentity extends TokenIdentity { cacheVersion: 1 }
const identities = new Map<string, CachedIdentity>();
let loaded = false;
const MAX_ITEMS = 80;
const MAX_JSON_BYTES = 64 * 1024;
const IPFS_GATEWAYS = ["https://flap.mypinata.cloud/ipfs/", "https://gateway.pinata.cloud/ipfs/"] as const;
const path = () => resolve(process.env["NEXA_TOKEN_METADATA_PATH"]?.trim() || ".data/nexa-token-metadata.json");
const cleanCid = (value: string | undefined) => value?.trim().replace(/^ipfs:\/\//, "").split(/[?#]/)[0];
const safeCid = (value: string | undefined) => { const cid = cleanCid(value); return cid && /^[a-zA-Z0-9]+$/.test(cid) && cid.length <= 120 ? cid : undefined; };

async function load() {
  if (loaded) return; loaded = true;
  try { for (const item of (JSON.parse(await readFile(path(), "utf8")) as { identities: CachedIdentity[] }).identities ?? []) identities.set(item.address.toLowerCase(), item); } catch { /* first boot */ }
}
async function save() {
  const file = path(); await mkdir(dirname(file), { recursive: true });
  const values = [...identities.values()].slice(-MAX_ITEMS);
  await writeFile(`${file}.tmp`, JSON.stringify({ identities: values, updatedAt: new Date().toISOString() })); await rename(`${file}.tmp`, file);
}
function decodeAbiString(value: string) {
  const offset = Number(wordBig(value, 0)) * 2 + 2; const length = Number.parseInt(value.slice(offset, offset + 64), 16);
  if (!Number.isSafeInteger(length) || length < 0 || length > 512) return "";
  try { return new TextDecoder().decode(Uint8Array.from(value.slice(offset + 64, offset + 64 + length * 2).match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16))).replace(/[\u0000-\u001f\u007f]/g, "").trim(); } catch { return ""; }
}
async function contractString(token: Hex, method: "name()" | "symbol()") {
  try { return decodeAbiString((await rpc<string>("eth_call", [{ to: token, data: selector(method) }, "latest"])).value).slice(0, method === "symbol()" ? 24 : 80); } catch { return ""; }
}
async function contractNumber(token: Hex, method: "decimals()" | "totalSupply()") {
  try { return wordBig((await rpc<string>("eth_call", [{ to: token, data: selector(method) }, "latest"])).value, 0); } catch { return undefined; }
}
async function blockTime(blockNumber: number) {
  try { const block = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, false]); return new Date(Number.parseInt(block.value.timestamp, 16) * 1000).toISOString(); } catch { return undefined; }
}
async function flapImage(metaCid: string | undefined) {
  const cid = safeCid(metaCid); if (!cid) return undefined;
  for (const gateway of IPFS_GATEWAYS) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await fetch(`${gateway}${cid}`, { signal: controller.signal, headers: { accept: "application/json" } });
      const size = Number(response.headers.get("content-length") ?? 0);
      if (!response.ok || size > MAX_JSON_BYTES) continue;
      const text = (await response.text()).slice(0, MAX_JSON_BYTES + 1); if (text.length > MAX_JSON_BYTES) continue;
      const body = JSON.parse(text) as { image?: unknown };
      const imageCid = safeCid(typeof body.image === "string" ? body.image : undefined);
      if (imageCid) return `/api/public/nexa-token-image?cid=${encodeURIComponent(imageCid)}`;
    } catch { /* try the next trusted IPFS gateway */ } finally { clearTimeout(timer); }
  }
  return undefined;
}

export async function resolveTokenIdentity(input: { address: Hex; creator?: Hex; createdBlock: number; detectedAt: string; eventName?: string; eventSymbol?: string; metaCid?: string }) {
  await load(); const key = input.address.toLowerCase(); const cached = identities.get(key);
  if (cached && (!input.metaCid || cached.metaCid === safeCid(input.metaCid))) return cached;
  const [name, symbol, decimals, totalSupply, createdAt, imageUrl] = await Promise.all([
    contractString(input.address, "name()"), contractString(input.address, "symbol()"), contractNumber(input.address, "decimals()"),
    contractNumber(input.address, "totalSupply()"), blockTime(input.createdBlock), flapImage(input.metaCid),
  ]);
  const eventName = input.eventName?.trim().slice(0, 80), eventSymbol = input.eventSymbol?.trim().slice(0, 24);
  const resolvedName = name || eventName, resolvedSymbol = symbol || eventSymbol, resolvedMetaCid = safeCid(input.metaCid);
  const identity: CachedIdentity = {
    cacheVersion: 1, address: input.address, ...(resolvedName ? { name: resolvedName } : {}), ...(resolvedSymbol ? { symbol: resolvedSymbol } : {}), createdBlock: input.createdBlock,
    detectedAt: input.detectedAt, ...(createdAt ? { createdAt } : {}), ...(input.creator ? { creator: input.creator } : {}),
    ...(decimals !== undefined && decimals <= 255n ? { decimals: Number(decimals) } : {}), ...(totalSupply !== undefined ? { totalSupplyRaw: totalSupply.toString() } : {}),
    ...(resolvedMetaCid ? { metaCid: resolvedMetaCid } : {}), ...(imageUrl ? { imageUrl, imageSource: "flap-ipfs" as const } : {}),
    metadataSource: name || symbol ? (eventName || eventSymbol ? "mixed" : "token-contract") : "flap-token-created", metadataObservedAt: new Date().toISOString(),
  };
  identities.set(key, identity); await save().catch(() => undefined); return identity;
}

export async function tokenIdentityCatalog() { await load(); return [...identities.values()].slice(-40).reverse(); }
export async function tokenIdentityByAddress(address: string) { await load(); return identities.get(address.toLowerCase()); }
export async function updateTokenMetrics(address: string, patch: Partial<TokenIdentity>) {
  await load(); const current = identities.get(address.toLowerCase()); if (!current) return;
  identities.set(address.toLowerCase(), { ...current, ...patch }); await save().catch(() => undefined);
}