# NEXA architecture

NEXA separates chain ingestion, normalized domain events, agent reasoning, policy, execution, and presentation.

```text
BSC RPC → indexer/checkpoint → normalized event bus → SCOUT/ANALYST → BRAIN
                                                               ↓
UI ← WebSocket/SSE ← event bus ← MEMORY/VOICE       TradeIntent → POLICY → EXECUTOR → SIGNER → BSC
                            ↑                                      ↓ confirmed receipt + Transfer logs
                token metadata + positions ledger ←──────── verified fill accounting
```

The current stream reads BSC centrally on the server, shares a warm-instance cache, and atomically persists its cursor to the configured server-side checkpoint path. A production deployment must mount that path on durable storage; multi-instance indexing requires a shared database or queue. Browser components never call RPC directly.

The Portal address and `TokenCreated` event come from Flap's official deployed-contract and developer documentation. `TokenCreated.meta` is an IPFS CID; server-side metadata resolution uses Flap's documented Pinata gateway and persists the verified token-to-CID mapping. Contract `name`, `symbol`, `decimals`, and supply are preferred for identity.

Position ownership is a separate persisted read model. It accepts only confirmed `LIVE_LIMITED`/`LIVE_AUTONOMOUS` receipts with a real token `Transfer` to or from `NEXA_WALLET_ADDRESS`. Intents, pending transactions, reverted transactions, and dry runs cannot mutate it. Startup reconciliation replays confirmed execution-ledger rows through their chain receipts, idempotently keyed by transaction hash and side.
