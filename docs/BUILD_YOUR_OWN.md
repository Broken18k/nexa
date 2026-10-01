# Build your own NEXA

1. **Fork & install** — `bun install`, `bun run dev`.
2. **RPC** — `BSC_RPC_URLS` (head reads, primary first) and `BSC_LOG_RPC_URLS` (endpoints that serve `eth_getLogs`). NEXA probes each endpoint for log capability every 10 minutes, scores health, and fails over automatically. Public endpoints work for evaluation only.
3. **Agent wallet** — `NEXA_WALLET_ADDRESS` (public address).
4. **Signer** — add `NEXA_PRIVATE_KEY` (or `NEXA_SIGNER_PRIVATE_KEY`) to your host's secret store. Its derived address must equal `NEXA_WALLET_ADDRESS` or execution stays `NO_SIGNER`. Use a dedicated, low-balance wallet.
5. **Flap** — Portal `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0` with `TokenCreated` and `LaunchedToDEX` (src/nexa/config.ts). Bonding-curve pricing/trading needs a verified Portal quote/trade ABI (`FLAP_PORTAL_QUOTE_ABI`, not yet wired). Re-verify against docs.flap.sh.
6. **Pricing** — Pancake v2 factory/router (developer.pancakeswap.finance). Quotes carry pair, block and timestamp; stale quotes (>60s) block execution.
7. **Indexer storage** — `NEXA_CHECKPOINT_PATH`, `NEXA_HOLDER_INDEX_PATH`, `NEXA_LEDGER_PATH` on durable storage.
8. **Policy** — `NEXA_MAX_*`, `NEXA_COOLDOWN_SECONDS`, `NEXA_MAX_SLIPPAGE_BPS`, `NEXA_MIN_LIQUIDITY_BNB`, `NEXA_MAX_SNAPSHOT_AGE_SECONDS`, `NEXA_EMERGENCY_STOP`. Code ceilings clamp every value.
9. **Gas** — `NEXA_MAX_GAS_LIMIT`, `NEXA_MAX_GAS_PRICE_GWEI`, `NEXA_CONFIRMATIONS`, `NEXA_TX_TIMEOUT_SECONDS`.
10. **Social** — implement `SocialPublisher` server-side; disabled by default.
11. **Activate** — run in `DRY_RUN` until simulations pass, then set `NEXA_EXECUTION_MODE=LIVE_LIMITED` and `NEXA_EMERGENCY_STOP=false`.

Never commit keys. Rotate any key that has appeared in chat, logs, screenshots or git.
