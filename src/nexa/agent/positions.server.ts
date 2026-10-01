import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DecisionAction, PositionFill, PositionSnapshot, TokenIdentity } from "../types";
import { applyWeightedAverageFill } from "../position-accounting";

export interface VerifiedFill extends PositionFill {
  mode: "LIVE_LIMITED" | "LIVE_AUTONOMOUS"; receiptConfirmed: true; token: TokenIdentity;
}
interface PositionFile { positions: PositionSnapshot[]; processedFillKeys: string[]; updatedAt: string }
let positions: PositionSnapshot[] = []; let processed = new Set<string>(); let loaded = false;
const MAX_CLOSED = 100, MAX_FILLS = 100;
const path = () => resolve(process.env["NEXA_POSITIONS_PATH"]?.trim() || ".data/nexa-positions.json");

export async function loadPositions() {
  if (loaded) return; loaded = true;
  try { const data = JSON.parse(await readFile(path(), "utf8")) as PositionFile; positions = data.positions ?? []; processed = new Set(data.processedFillKeys ?? []); } catch { positions = []; processed = new Set(); }
}
async function save() {
  const file = path(); await mkdir(dirname(file), { recursive: true });
  const bounded = [...positions.filter((item) => item.status !== "CLOSED"), ...positions.filter((item) => item.status === "CLOSED").slice(0, MAX_CLOSED)];
  await writeFile(`${file}.tmp`, JSON.stringify({ positions: bounded, processedFillKeys: [...processed].slice(-500), updatedAt: new Date().toISOString() })); await rename(`${file}.tmp`, file);
}
export async function applyConfirmedFill(fill: VerifiedFill) {
  await loadPositions();
  if (!fill.receiptConfirmed || (fill.mode !== "LIVE_LIMITED" && fill.mode !== "LIVE_AUTONOMOUS")) throw new Error("POSITION_REQUIRES_CONFIRMED_LIVE_FILL");
  if (processed.has(fill.fillKey)) return null;
  const key = fill.token.address.toLowerCase(); const existing = positions.find((item) => item.token.address.toLowerCase() === key && item.status !== "CLOSED");
  if (fill.side === "SELL" && !existing) throw new Error("OPEN_POSITION_NOT_FOUND");
  const base = existing ?? {
    positionId: `pos-${key.slice(2)}`, token: fill.token, status: "OPEN" as const, quantityRaw: "0", openedAt: fill.timestamp, updatedAt: fill.timestamp,
    entryTxHash: fill.txHash, costBasisBnb: 0, bnbSpent: 0, gasBnb: 0, fills: [],
  };
  const accounting = applyWeightedAverageFill(base, fill);
  const nextQuantity = BigInt(accounting.quantityRaw); const status = nextQuantity === 0n ? "CLOSED" as const : "OPEN" as const;
  const next: PositionSnapshot = {
    ...base, ...accounting, token: { ...base.token, ...fill.token }, status, updatedAt: fill.timestamp,
    ...(status === "CLOSED" ? { closedAt: fill.timestamp } : {}), ...(fill.side === "SELL" ? { lastExitTxHash: fill.txHash } : {}),
    ...(fill.side === "BUY" && fill.bnbAmount !== undefined ? { entryPriceBnb: fill.bnbAmount / (Number(fill.quantityRaw) / 10 ** (fill.token.decimals ?? 18)) } : {}),
    fills: [...base.fills, fill].slice(-MAX_FILLS),
  };
  positions = existing ? positions.map((item) => item.positionId === existing.positionId ? next : item) : [next, ...positions];
  processed.add(fill.fillKey); await save();
  return { position: next, eventType: existing ? (status === "CLOSED" ? "POSITION_CLOSED" as const : "POSITION_UPDATED" as const) : "POSITION_OPENED" as const };
}
export async function positionSnapshots() { await loadPositions(); return { open: positions.filter((item) => item.status !== "CLOSED").slice(0, 30), closed: positions.filter((item) => item.status === "CLOSED").slice(0, 50) }; }
export async function updatePositionMarket(address: string, data: { priceBnb?: number; liquidityBnb?: number; holders?: number; pricing?: PositionSnapshot["pricing"]; holdersProvenance?: PositionSnapshot["holdersProvenance"]; decision?: DecisionAction; rationale?: string; clearPricing?: boolean }) {
  await loadPositions(); const index = positions.findIndex((item) => item.token.address.toLowerCase() === address.toLowerCase() && item.status !== "CLOSED"); if (index < 0) return null;
  const current = positions[index]; if (!current) return null;
  const decimals = current.token.decimals ?? 18; const quantity = Number(current.quantityRaw) / 10 ** decimals;
  const currentValueBnb = data.priceBnb !== undefined ? quantity * data.priceBnb : undefined;
  const unrealizedPnlBnb = currentValueBnb !== undefined ? currentValueBnb - current.costBasisBnb : undefined;
  const next: PositionSnapshot = { ...current, updatedAt: new Date().toISOString(), ...(data.priceBnb !== undefined ? { currentPriceBnb: data.priceBnb } : {}), ...(currentValueBnb !== undefined ? { currentValueBnb } : {}), ...(unrealizedPnlBnb !== undefined ? { unrealizedPnlBnb, unrealizedPnlPct: current.costBasisBnb > 0 ? unrealizedPnlBnb / current.costBasisBnb * 100 : 0 } : {}), ...(data.liquidityBnb !== undefined ? { liquidityBnb: data.liquidityBnb } : {}), ...(data.holders !== undefined ? { holders: data.holders } : {}), ...(data.pricing ? { pricing: data.pricing } : {}), ...(data.holdersProvenance ? { holdersProvenance: data.holdersProvenance } : {}), ...(data.decision ? { currentDecision: data.decision } : {}), ...(data.rationale ? { rationale: data.rationale } : {}) };
  if (data.clearPricing) { delete next.currentPriceBnb; delete next.currentValueBnb; delete next.unrealizedPnlBnb; delete next.unrealizedPnlPct; delete next.liquidityBnb; delete next.pricing; }
  positions[index] = next; await save().catch(() => undefined); return next;
}