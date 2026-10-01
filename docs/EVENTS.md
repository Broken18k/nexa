# Normalized events

Every event carries a stable ID, type, priority, ISO timestamp, chain ID, verifiable source metadata, and optional block number, transaction hash, contract address, and token reference.

Supported event names: `TOKEN_DETECTED`, `TOKEN_SNAPSHOT`, `TOKEN_ANALYSIS_STARTED`, `TOKEN_ANALYSIS_UPDATED`, `DECISION_CREATED`, `WATCHLIST_ADDED`, `WATCHLIST_REMOVED`, `TRADE_INTENT_CREATED`, `TRADE_BLOCKED`, `TRADE_EXECUTION_STARTED`, `TRADE_EXECUTED`, `TX_CONFIRMED`, `TX_FAILED`, `POSITION_OPENED`, `POSITION_UPDATED`, `POSITION_CLOSED`, `SELF_TOKEN_DETECTED`, `SELF_BUY`, `SELF_SELL`, `NEW_HOLDER`, `WHALE_ACTIVITY`, `MEMORY_UPDATED`, `SYSTEM_STATUS`, and `RPC_STATUS`.

Production narration is derived from an event's structured payload and retains the event ID. Quiet chains produce quiet narration.

`POSITION_OPENED`, `POSITION_UPDATED`, and `POSITION_CLOSED` carry a persisted position snapshot. `POSITION_OPENED` can only follow a confirmed live receipt and verified token Transfer into the configured wallet. Dry runs remain execution test events and never emit position ownership.
