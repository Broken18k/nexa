import type { AgentDecision, PolicyConfig, PolicyContext, PolicyResult, TokenMetrics, TokenRef, TradeIntent } from "../types";
export interface Scout { observe(blockNumber: number): Promise<TokenRef[]>; }
export interface Analyst { analyze(token: TokenRef, blockNumber: number): Promise<TokenMetrics>; }
export interface Brain { decide(token: TokenRef, metrics: TokenMetrics): AgentDecision; }
export interface Trader { createIntent(decision: AgentDecision): TradeIntent | null; }
export interface SelfMonitor { inspectTransaction(txHash: `0x${string}`): Promise<TokenRef | null>; }
export interface Memory { remember(decision: AgentDecision): Promise<void>; }
export interface Voice { narrate(eventId: string): string | null; }
export interface Executor { execute(intent: TradeIntent): Promise<{ txHash: `0x${string}` }>; }
export interface Signer { signTransaction(serializedTransaction: string): Promise<string>; }

export class PolicyEngine {
  constructor(private readonly config: PolicyConfig) {}
  validate(intent: TradeIntent, context: PolicyContext): PolicyResult {
    const reasons: string[] = [];
    if (this.config.emergencyStop) reasons.push("EMERGENCY_STOP");
    if (intent.chainId !== this.config.allowedChainId) reasons.push("CHAIN_NOT_ALLOWED");
    if (!this.config.allowedProtocols.map((value) => value.toLowerCase()).includes(intent.protocolAddress.toLowerCase())) reasons.push("PROTOCOL_NOT_ALLOWED");
    if (intent.amountBnb > this.config.maxTradeSizeBnb) reasons.push("MAX_TRADE_SIZE");
    if (context.totalExposureBnb + intent.amountBnb > this.config.maxTotalExposureBnb) reasons.push("MAX_TOTAL_EXPOSURE");
    if (context.tokenExposureBnb + intent.amountBnb > this.config.maxTokenExposureBnb) reasons.push("MAX_TOKEN_EXPOSURE");
    if (context.dailyLossBnb >= this.config.maxDailyLossBnb) reasons.push("MAX_DAILY_LOSS");
    if (intent.slippageBps > this.config.maxSlippageBps) reasons.push("MAX_SLIPPAGE");
    if ((context.liquidityBnb ?? 0) < this.config.minimumLiquidityBnb) reasons.push("MINIMUM_LIQUIDITY");
    if (context.seenIntentIds.has(intent.intentId)) reasons.push("DUPLICATE_INTENT");
    if (context.lastTradeAt && Date.now() - Date.parse(context.lastTradeAt) < this.config.cooldownSeconds * 1000) reasons.push("COOLDOWN");
    return { allowed: reasons.length === 0, reasons };
  }
}
