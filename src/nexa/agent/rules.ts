import type { AutonomyCounters, HardLimits, NexaEvent, OutcomeClass, ProtectionReason, ProtectionState, TokenMetrics } from "../types";

/** Conservative defaults. Hard limits are configuration, never adaptive or model-writable. */
export const DEFAULT_HARD_LIMITS: HardLimits = {
  maxTradeSizeBnb: 0.02, maxTotalExposureBnb: 0.1, maxTokenExposureBnb: 0.05, maxDailyLossBnb: 0.02,
  cooldownSeconds: 900, maxSlippageBps: 300, minimumLiquidityBnb: 25, maxSnapshotAgeSeconds: 30, emergencyStop: true,
};

export const EMPTY_COUNTERS: AutonomyCounters = { autonomousActions: 0, humanActions: 0, decisions: 0, blockedByPolicy: 0, confirmedTx: 0, memories: 0 };

/**
 * Counting rules (also documented in docs/AUTONOMY.md):
 * - AUTONOMOUS ACTIONS: TRADE_EXECUTION_STARTED with initiator "autonomous" (system began an action with no human trigger).
 * - HUMAN ACTIONS: any event with initiator "human" (e.g. a manual self-token launch from the NEXA wallet).
 * - DECISIONS: DECISION_CREATED. BLOCKED BY POLICY: TRADE_BLOCKED. CONFIRMED TX: TX_CONFIRMED with a real txHash.
 * - MEMORIES: OUTCOME_RECORDED and MEMORY_UPDATED.
 */
export function countEvent(counters: AutonomyCounters, event: NexaEvent): AutonomyCounters {
  const next = { ...counters };
  if (event.type === "TRADE_EXECUTION_STARTED" && event.initiator === "autonomous") next.autonomousActions += 1;
  if (event.initiator === "human") next.humanActions += 1;
  if (event.type === "DECISION_CREATED") next.decisions += 1;
  if (event.type === "TRADE_BLOCKED") next.blockedByPolicy += 1;
  if (event.type === "TX_CONFIRMED" && event.txHash) next.confirmedTx += 1;
  if (event.type === "OUTCOME_RECORDED" || event.type === "MEMORY_UPDATED") next.memories += 1;
  return next;
}

export interface ProtectionInput {
  chainId: number; rpcHealthy: boolean; blockAgeSeconds: number; pricingVerified: boolean; signerConnected: boolean;
  emergencyStop: boolean; dailyLossBnb: number; totalExposureBnb: number; limits: HardLimits; unexpectedExecutionState?: boolean;
}
/** Global capital-protection evaluation. Per-intent checks (liquidity, slippage, duplicate, stale snapshot) live in PolicyEngine. */
export function evaluateProtection(input: ProtectionInput): ProtectionState {
  const reasons: ProtectionReason[] = [];
  if (input.emergencyStop) reasons.push("EMERGENCY_STOP");
  if (input.chainId !== 56) reasons.push("CHAIN_MISMATCH");
  if (!input.rpcHealthy) reasons.push("RPC_UNHEALTHY");
  if (input.blockAgeSeconds > 20) reasons.push("RPC_STALE");
  if (!input.pricingVerified) reasons.push("PRICING_UNVERIFIED");
  if (!input.signerConnected) reasons.push("SIGNER_UNAVAILABLE");
  if (input.dailyLossBnb >= input.limits.maxDailyLossBnb) reasons.push("DAILY_LOSS_LIMIT");
  if (input.totalExposureBnb >= input.limits.maxTotalExposureBnb) reasons.push("MAX_EXPOSURE");
  if (input.unexpectedExecutionState) reasons.push("UNEXPECTED_EXECUTION_STATE");
  return { state: reasons.length ? "PROTECTING_CAPITAL" : "NORMAL", executionPaused: reasons.length > 0, reasons };
}

/** Bounded risk adaptation: multiplier of hard trade size, clamped to [0.25, 1]. Can never exceed hard limits. */
export const RISK_MIN = 0.25, RISK_MAX = 1;
export function adaptRisk(current: number, recentPnlBnb: number[]): { next: number; evidence: string } | null {
  if (recentPnlBnb.length < 3) return null;
  const last3 = recentPnlBnb.slice(-3);
  let next = current;
  if (last3.every((value) => value < 0)) next = current * 0.5;
  else if (recentPnlBnb.length >= 5 && recentPnlBnb.slice(-5).every((value) => value > 0)) next = current * 1.25;
  next = Math.min(RISK_MAX, Math.max(RISK_MIN, Number(next.toFixed(3))));
  if (next === current) return null;
  return { next, evidence: next < current ? "3_CONSECUTIVE_LOSSES" : "5_CONSECUTIVE_VALIDATED_WINS" };
}
export function effectiveTradeSize(limits: HardLimits, multiplier: number) { return Math.min(limits.maxTradeSizeBnb, limits.maxTradeSizeBnb * Math.min(RISK_MAX, multiplier)); }

/** Post-trade reflection classifier. Only called with a real closed position. */
export function classifyOutcome(entry: TokenMetrics, exit: TokenMetrics, pnlBnb: number, exitReasons: string[]): { outcome: OutcomeClass; reflection: string } {
  if (exitReasons.includes("EMERGENCY_STOP") || exitReasons.includes("DAILY_LOSS_LIMIT")) return { outcome: "RISK_EXIT", reflection: "Exited to protect capital under a risk rule." };
  if (exitReasons.includes("STOP_CONDITION")) return { outcome: "STOP_CONDITION", reflection: "Stop condition triggered; position closed as configured." };
  if ((exit.liquidityBnb ?? 0) < (entry.liquidityBnb ?? 0) * 0.7) return { outcome: "LIQUIDITY_DETERIORATED", reflection: "Liquidity fell over 30% after entry." };
  if (pnlBnb > 0 && (exit.priceMovement ?? 0) > 0 && (exit.volumeMomentum ?? 0) > 1) return { outcome: "EARLY_EXIT", reflection: "Closed in profit while momentum was still positive." };
  if (pnlBnb > 0) return { outcome: "THESIS_CORRECT", reflection: "Entry thesis held; closed in profit." };
  if ((exit.volumeMomentum ?? 0) < (entry.volumeMomentum ?? 0)) return { outcome: "MOMENTUM_FAILED", reflection: "Momentum faded after entry; closed at a loss." };
  return { outcome: "OTHER", reflection: "Closed; outcome did not match a defined pattern." };
}
