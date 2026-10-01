# Security

## Signer boundary
- The signing key lives only in the server secret store (`NEXA_PRIVATE_KEY` or `NEXA_SIGNER_PRIVATE_KEY`).
- `src/nexa/agent/signer.server.ts` reads it inside function bodies, returns only presence, format validity and the derived **public** address, and exposes one operation: sign a fully policy-checked transaction.
- BRAIN produces structured decisions; Trader produces `TradeIntent`s. Neither sees the key.
- The browser receives no secret, no `VITE_*` secret, and no unrestricted transaction capability.

## Execution path
BRAIN → TradeIntent → Policy Engine → duplicate/stale/pricing/pending checks → `eth_estimateGas` simulation → gas ceilings → (DRY_RUN receipt | nonce allocation → sign → broadcast → receipt with confirmations). Every step is written to the persistent execution ledger.
- Duplicate decision/intent IDs are rejected.
- A pending or timed-out transaction locks execution. No automatic gas replacement: an operator must resolve it.
- Reverted and failed broadcasts are recorded explicitly; nonce re-syncs from chain.
- Position accounting has a second gate: only a confirmed live receipt with a verified wallet Transfer can create ownership. `TradeIntent`, simulation, and `DRY_RUN_*` states are rejected.

## Position accounting
- Weighted-average cost basis is used across confirmed buys.
- A partial confirmed sell releases the same proportion of cost basis; the remaining average cost is unchanged.
- Realized PnL is recorded only when sale proceeds are verifiable. Gross PnL excludes gas; net realized PnL subtracts proportional entry gas and confirmed exit gas, while cumulative gas remains separately visible.
- Open-position value and unrealized PnL are omitted when reserve pricing is missing or stale.

## Activation checklist (enforced in code)
CHAIN_ID_56 · SIGNER_PRESENT · SIGNER_MATCHES_WALLET · RPC_HEALTHY_FRESH · FLAP_CONTRACTS_VERIFIED · PRICING_FRESH · POLICY_ENGINE_ENABLED · EMERGENCY_STOP_DISABLED · EXECUTION_LIMITS_CONFIGURED · NO_SECRET_EXPOSURE · SIMULATION_PASSES.
Any failure keeps NEXA in DRY_RUN/NO_SIGNER and PROTECTING_CAPITAL.

## Operational warnings
Use a dedicated low-balance wallet. Rotate any key that was ever pasted into chat, logs, or committed. Keep emergency stop on until DRY_RUN results are reviewed.
