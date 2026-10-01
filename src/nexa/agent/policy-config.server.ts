import type { HardLimits } from "../types";
import { DEFAULT_HARD_LIMITS } from "./rules";

const num = (name: string, fallback: number, ceiling: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, ceiling) : fallback;
};
/** Hard limits from server env, each capped by an absolute ceiling so config typos can't open risk. */
export function readHardLimits(): HardLimits {
  return {
    maxTradeSizeBnb: num("NEXA_MAX_TRADE_BNB", DEFAULT_HARD_LIMITS.maxTradeSizeBnb, 0.5),
    maxTotalExposureBnb: num("NEXA_MAX_TOTAL_EXPOSURE_BNB", DEFAULT_HARD_LIMITS.maxTotalExposureBnb, 2),
    maxTokenExposureBnb: num("NEXA_MAX_TOKEN_EXPOSURE_BNB", DEFAULT_HARD_LIMITS.maxTokenExposureBnb, 0.5),
    maxDailyLossBnb: num("NEXA_MAX_DAILY_LOSS_BNB", DEFAULT_HARD_LIMITS.maxDailyLossBnb, 0.5),
    cooldownSeconds: num("NEXA_COOLDOWN_SECONDS", DEFAULT_HARD_LIMITS.cooldownSeconds, 86_400),
    maxSlippageBps: num("NEXA_MAX_SLIPPAGE_BPS", DEFAULT_HARD_LIMITS.maxSlippageBps, 1000),
    minimumLiquidityBnb: num("NEXA_MIN_LIQUIDITY_BNB", DEFAULT_HARD_LIMITS.minimumLiquidityBnb, 10_000),
    maxSnapshotAgeSeconds: num("NEXA_MAX_SNAPSHOT_AGE_SECONDS", DEFAULT_HARD_LIMITS.maxSnapshotAgeSeconds, 120),
    emergencyStop: process.env["NEXA_EMERGENCY_STOP"]?.trim().toLowerCase() !== "false",
  };
}
/** Presence check only. The secret value is never read here, returned, logged or serialized. */
export const signerConfigured = () => Boolean(process.env["NEXA_SIGNER_PRIVATE_KEY"]);
