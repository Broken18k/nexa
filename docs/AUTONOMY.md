# Autonomy, proof, replay and safety

## Counting rules (`src/nexa/agent/rules.ts → countEvent`)
- **AUTONOMOUS ACTIONS** — `TRADE_EXECUTION_STARTED` with `initiator: "autonomous"` (no human trigger).
- **HUMAN ACTIONS** — any event with `initiator: "human"`. A self-token launched manually from the NEXA wallet is a human action, never an autonomous launch.
- **DECISIONS** `DECISION_CREATED` · **BLOCKED BY POLICY** `TRADE_BLOCKED` · **CONFIRMED TX** `TX_CONFIRMED` with a real txHash · **MEMORIES** `OUTCOME_RECORDED` + `MEMORY_UPDATED`.
Counters are computed server-side and persisted in the checkpoint file.

## Capital protection
`evaluateProtection` returns `PROTECTING_CAPITAL` with structured reasons (RPC_UNHEALTHY, RPC_STALE, CHAIN_MISMATCH, PRICING_UNVERIFIED, SIGNER_UNAVAILABLE, DAILY_LOSS_LIMIT, MAX_EXPOSURE, UNEXPECTED_EXECUTION_STATE, EMERGENCY_STOP). Per-intent checks (liquidity, slippage, duplicate intent, stale snapshot, cooldown) run in `PolicyEngine` / `executeIntent`.

## Risk adaptation
`adaptRisk` scales trade size by a multiplier clamped to [0.25, 1] of the hard limit: ×0.5 after 3 consecutive losses, ×1.25 after 5 validated wins. Every change must emit `RISK_POLICY_UPDATED { old, new, evidence, timestamp }`. Hard limits come only from server env and cannot be raised by adaptation or any model output.

## Reflection
`classifyOutcome` produces THESIS_CORRECT / EARLY_EXIT / MOMENTUM_FAILED / LIQUIDITY_DETERIORATED / RISK_EXIT / STOP_CONDITION / OTHER from real entry/exit snapshots. Only called for a real closed position; emitted as `OUTCOME_RECORDED`.

## Decision receipts
Events sharing a `decisionId` form a receipt: decision → snapshot → intent → policy result → execution → txHash → receipt → position → outcome. Explorer links render only for real hashes/addresses.

## Replay
"Replay last 60 seconds" plays stored events from the bounded browser buffer over ~10 s. No RPC requests, no generated events.

## Social voice
`src/nexa/social/publisher.ts` drafts posts only from HIGH/CRITICAL events. Default `SOCIAL_PUBLISHING_DISABLED`; credentials (if ever) live in server secrets only.

This is operational memory and strategy state, not model retraining.
