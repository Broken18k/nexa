import type { DecisionAction, HardLimits, TokenMetrics, TokenRef } from "../types";

export interface SnapshotInput {
  token: TokenRef; blockNumber: number; observedAt: string;
  liquidityBnb?: number; priceBnb?: number; previousPriceBnb?: number; pricingSource?: string;
  holdersComplete: boolean; holders?: number; holderDelta?: number; top10Share?: number; transferMomentum?: number;
}
export interface BrainDecision {
  action: DecisionAction; priority: string; reasonCodes: string[]; explanation: string; confidence: number;
  metrics: TokenMetrics; signals: Record<string, { value?: number; reason: string }>;
}

/** Deterministic, explainable strategy. Every input comes from a real snapshot; missing inputs produce WATCH/IGNORE, never ENTER. */
export function decide(input: SnapshotInput, limits: HardLimits): BrainDecision {
  const signals: BrainDecision["signals"] = {};
  const reasons: string[] = [];
  const priceMovement = input.priceBnb && input.previousPriceBnb ? input.priceBnb / input.previousPriceBnb - 1 : undefined;
  if (input.liquidityBnb !== undefined && input.liquidityBnb >= limits.minimumLiquidityBnb) signals["LIQUIDITY_QUALITY"] = { value: Number(input.liquidityBnb.toFixed(2)), reason: "LIQUIDITY_ABOVE_MINIMUM" };
  if (input.top10Share !== undefined && input.top10Share > 0.5) signals["CONCENTRATION_RISK"] = { value: Number(input.top10Share.toFixed(3)), reason: "TOP10_ABOVE_50PCT" };
  if (input.holderDelta !== undefined && input.holderDelta > 0) signals["HOLDER_GROWTH"] = { value: input.holderDelta, reason: "HOLDERS_INCREASING" };
  if (input.transferMomentum !== undefined && input.transferMomentum > 1.5) signals["VOLUME_ACCELERATION"] = { value: Number(input.transferMomentum.toFixed(2)), reason: "TRANSFER_RATE_ACCELERATING" };
  if (priceMovement !== undefined && priceMovement > 0.05) signals["MOMENTUM"] = { value: Number(priceMovement.toFixed(3)), reason: "PRICE_UP_5PCT" };

  let action: DecisionAction = "WATCH";
  if (input.priceBnb === undefined || input.liquidityBnb === undefined) { reasons.push("PRICING_UNVERIFIED"); action = input.holderDelta && input.holderDelta > 0 ? "WATCH" : "IGNORE"; }
  else if (input.liquidityBnb < limits.minimumLiquidityBnb) { reasons.push("LIQUIDITY_BELOW_MINIMUM"); action = "IGNORE"; }
  else if (!input.holdersComplete) { reasons.push("HOLDER_INDEX_INCOMPLETE"); action = "WATCH"; }
  else if ((input.top10Share ?? 1) > 0.5) { reasons.push("CONCENTRATION_TOO_HIGH"); action = "IGNORE"; }
  else if (!signals["HOLDER_GROWTH"] && !signals["MOMENTUM"] && !signals["VOLUME_ACCELERATION"]) { reasons.push("NO_POSITIVE_FLOW"); action = "WATCH"; }
  else { reasons.push("LIQUIDITY_OK", "CONCENTRATION_OK", ...Object.values(signals).map((signal) => signal.reason)); action = "ENTER"; }

  const supporting = Object.keys(signals).filter((key) => key !== "CONCENTRATION_RISK").length;
  const confidence = action === "ENTER" ? Math.min(0.9, 0.5 + supporting * 0.1) : action === "WATCH" ? 0.35 : 0.2;
  const priority = signals["VOLUME_ACCELERATION"] ? "VOLUME_ACCELERATION" : signals["HOLDER_GROWTH"] ? "HOLDER_GROWTH" : signals["LIQUIDITY_QUALITY"] ? "LIQUIDITY_QUALITY" : "DISCOVERY";
  const label = input.token.symbol || input.token.address.slice(0, 10);
  const explanation = `${action} ${label}: ${reasons.join(", ").toLowerCase().replaceAll("_", " ")}.`;
  return {
    action, priority, reasonCodes: reasons, explanation, confidence,
    metrics: { blockNumber: input.blockNumber, observedAt: input.observedAt, ...(input.liquidityBnb !== undefined ? { liquidityBnb: input.liquidityBnb } : {}), ...(input.holderDelta !== undefined ? { holderDelta: input.holderDelta } : {}), ...(input.top10Share !== undefined ? { concentration: input.top10Share } : {}), ...(input.transferMomentum !== undefined ? { volumeMomentum: input.transferMomentum } : {}), ...(priceMovement !== undefined ? { priceMovement } : {}) },
    signals,
  };
}
