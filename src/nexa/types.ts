export type ProviderStatus = "connecting" | "live" | "config_required" | "degraded" | "offline";
export type EventPriority = "critical" | "high" | "medium" | "low";
export type NexaEventType =
  | "TOKEN_DETECTED" | "TOKEN_SNAPSHOT" | "TOKEN_ANALYSIS_STARTED" | "TOKEN_ANALYSIS_UPDATED"
  | "DECISION_CREATED" | "WATCHLIST_ADDED" | "WATCHLIST_REMOVED" | "TRADE_INTENT_CREATED"
  | "TRADE_BLOCKED" | "TRADE_EXECUTION_STARTED" | "TRADE_EXECUTED" | "TX_CONFIRMED" | "TX_FAILED"
  | "POSITION_OPENED" | "POSITION_UPDATED" | "POSITION_CLOSED" | "SELF_TOKEN_DETECTED" | "SELF_BUY"
  | "SELF_SELL" | "NEW_HOLDER" | "WHALE_ACTIVITY" | "MEMORY_UPDATED" | "SYSTEM_STATUS" | "RPC_STATUS"
  | "RISK_POLICY_UPDATED" | "EXECUTION_PAUSED" | "EXECUTION_RESUMED" | "OUTCOME_RECORDED";
export type Initiator = "autonomous" | "human" | "system";

export interface EventSourceMeta {
  provider: "bsc-rpc" | "flap-portal" | "nexa-agent";
  mode: "live";
  verifiable: true;
  rpcUrlLabel?: string;
}

export interface NexaEvent<T = Record<string, unknown>> {
  id: string;
  type: NexaEventType;
  priority: EventPriority;
  timestamp: string;
  chainId: 56;
  source: EventSourceMeta;
  blockNumber?: number;
  txHash?: `0x${string}`;
  contractAddress?: `0x${string}`;
  token?: TokenRef;
  decisionId?: string;
  initiator?: Initiator;
  data: T;
}

export interface TokenRef { address: `0x${string}`; symbol?: string; name?: string; }
export interface MetricProvenance { source: string; observedAt: string; blockNumber?: number; complete?: boolean; }
export interface TokenIdentity extends TokenRef {
  decimals?: number; creator?: `0x${string}`; createdBlock: number; detectedAt: string; createdAt?: string;
  metaCid?: string; imageUrl?: string; imageSource?: "flap-ipfs"; metadataSource: "token-contract" | "flap-token-created" | "mixed";
  metadataObservedAt: string; totalSupplyRaw?: string;
  priceBnb?: number; priceUsd?: number; marketCapUsd?: number; liquidityBnb?: number; pricing?: MetricProvenance;
  holders?: number; concentration?: number; holdersProvenance?: MetricProvenance;
}
export interface PositionFill {
  fillKey: string; side: "BUY" | "SELL"; txHash: `0x${string}`; blockNumber: number; timestamp: string;
  quantityRaw: string; bnbAmount?: number; gasBnb?: number; decisionId: string;
}
export interface PositionSnapshot {
  positionId: string; token: TokenIdentity; status: "OPEN" | "CLOSING" | "CLOSED"; quantityRaw: string;
  openedAt: string; updatedAt: string; closedAt?: string; entryTxHash: `0x${string}`; lastExitTxHash?: `0x${string}`;
  entryPriceBnb?: number; costBasisBnb: number; bnbSpent: number; gasBnb: number; entryGasBasisBnb?: number; realizedPnlGrossBnb?: number; realizedPnlBnb?: number;
  currentPriceBnb?: number; currentValueBnb?: number; unrealizedPnlBnb?: number; unrealizedPnlPct?: number;
  liquidityBnb?: number; holders?: number; pricing?: MetricProvenance; holdersProvenance?: MetricProvenance;
  currentDecision?: DecisionAction; rationale?: string; fills: PositionFill[];
}
export interface DryRunIntent { intentId: string; decisionId: string; token: TokenRef; amountBnb: number; status: "DRY_RUN_OK" | "DRY_RUN_FAILED"; createdAt: string; reasons: string[]; }
export interface TokenMetrics {
  liquidityBnb?: number;
  volumeMomentum?: number;
  holderDelta?: number;
  concentration?: number;
  walletActivity?: number;
  priceMovement?: number;
  blockNumber: number;
  observedAt: string;
}
export type DecisionAction = "IGNORE" | "WATCH" | "ENTER" | "HOLD" | "REDUCE" | "EXIT";
export interface AgentDecision {
  decisionId: string; token: TokenRef; timestamp: string; metrics: TokenMetrics;
  reasonCodes: string[]; explanation: string; confidence: number; source: EventSourceMeta;
}
export interface TradeIntent {
  intentId: string; decisionId: string; token: TokenRef; side: "BUY" | "SELL";
  amountBnb: number; slippageBps: number; chainId: 56; protocolAddress: `0x${string}`; createdAt: string;
}
export interface PolicyConfig {
  maxTradeSizeBnb: number; maxTotalExposureBnb: number; maxTokenExposureBnb: number;
  maxDailyLossBnb: number; cooldownSeconds: number; maxSlippageBps: number;
  minimumLiquidityBnb: number; allowedChainId: 56; allowedProtocols: `0x${string}`[]; emergencyStop: boolean;
}
export interface PolicyContext { totalExposureBnb: number; tokenExposureBnb: number; dailyLossBnb: number; liquidityBnb?: number; lastTradeAt?: string; seenIntentIds: Set<string>; }
export interface PolicyResult { allowed: boolean; reasons: string[]; }
export interface SystemSnapshot {
  status: ProviderStatus; chainId: 56; chainName: "BNB Smart Chain"; rpcStatus: "healthy" | "slow" | "offline";
  lastBlock?: number; blockObservedAt?: string; latencyMs?: number; eventRate: number; queueDepth: number;
  walletAddress?: `0x${string}`; walletBalanceBnb?: string; flapPortal: `0x${string}`;
  flapConfigured: boolean; walletConfigured: boolean; executionMode: ExecutionMode; requestedExecutionMode: ExecutionMode;
  modules: Record<"SCOUT" | "ANALYST" | "BRAIN" | "TRADER" | "MEMORY" | "WALLET" | "FLAP", "ready" | "waiting" | "offline">;
  protection: ProtectionState; hardLimits: HardLimits; riskMultiplier: number; counters: AutonomyCounters;
  signer: "NOT_CONFIGURED" | "INVALID_FORMAT" | "WALLET_REQUIRED" | "WALLET_MISMATCH" | "READY"; signerAddress?: `0x${string}`;
  integrations: Record<IntegrationName, IntegrationStatus>; readiness: ReadinessCheck[]; bnbUsd?: number; pricingObservedAt?: string; social: "SOCIAL_PUBLISHING_DISABLED";
  detectedTokens: TokenIdentity[]; selfToken?: TokenIdentity; openPositions: PositionSnapshot[]; closedPositions: PositionSnapshot[]; dryRunIntents: DryRunIntent[];
}
export type ProtectionReason =
  | "RPC_UNHEALTHY" | "RPC_STALE" | "CHAIN_MISMATCH" | "PRICING_UNVERIFIED" | "LIQUIDITY_BELOW_MINIMUM"
  | "EXCESSIVE_SLIPPAGE" | "DUPLICATE_INTENT" | "STALE_DECISION_SNAPSHOT" | "DAILY_LOSS_LIMIT"
  | "MAX_EXPOSURE" | "SIGNER_UNAVAILABLE" | "UNEXPECTED_EXECUTION_STATE" | "EMERGENCY_STOP";
export interface ProtectionState { state: "NORMAL" | "PROTECTING_CAPITAL"; executionPaused: boolean; reasons: ProtectionReason[]; }
export interface HardLimits {
  maxTradeSizeBnb: number; maxTotalExposureBnb: number; maxTokenExposureBnb: number; maxDailyLossBnb: number;
  cooldownSeconds: number; maxSlippageBps: number; minimumLiquidityBnb: number; maxSnapshotAgeSeconds: number; emergencyStop: boolean;
}
export interface AutonomyCounters { autonomousActions: number; humanActions: number; decisions: number; blockedByPolicy: number; confirmedTx: number; memories: number; }
export type OutcomeClass = "THESIS_CORRECT" | "EARLY_EXIT" | "MOMENTUM_FAILED" | "LIQUIDITY_DETERIORATED" | "RISK_EXIT" | "STOP_CONDITION" | "OTHER";
export interface TradeOutcome {
  positionId: string; decisionId: string; token: TokenRef; strategy: string; entry: TokenMetrics; exit: TokenMetrics;
  entryTxHash: `0x${string}`; exitTxHash: `0x${string}`; realizedPnlBnb: number; durationSeconds: number; reasonCodes: string[]; outcome: OutcomeClass; reflection: string;
}
export type ExecutionMode = "NO_SIGNER" | "SIGNER_READY" | "DRY_RUN" | "LIVE_LIMITED" | "LIVE_AUTONOMOUS";
export type IntegrationName = "RPC" | "INDEXER" | "FLAP" | "PRICING" | "HOLDERS" | "WALLET" | "SIGNER" | "EXECUTION";
export interface IntegrationStatus { state: "ok" | "degraded" | "config_required" | "offline"; detail: string; missing?: string[] }
export interface ReadinessCheck { id: string; ok: boolean; detail: string }
export interface StreamPacket { snapshot: SystemSnapshot; events: NexaEvent[]; }
