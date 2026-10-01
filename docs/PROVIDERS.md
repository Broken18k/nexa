# Providers

- **RPC pool** (`bsc-rpc.server.ts`): head pool `BSC_RPC_URLS`, log pool `BSC_LOG_RPC_URLS`; health scoring, backoff, failover, `eth_getLogs` capability probe every 10 min. Defaults: Binance dataseed (head), PublicNode + 1RPC (log-capable as probed).
- **Flap** (`indexer.server.ts`): Portal `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0`, `TokenCreated` and `LaunchedToDEX` topics; cursor is held (no gaps) when log queries fail; ranges capped at 200 blocks per tick with catch-up.
- **Pricing** (`pricing.server.ts`): Pancake v2 factory `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73`, router `0x10ED43C718714eb63d5aA57B78B54704E256024E`, WBNB/USDT reserves for BNB/USD. `PricingProvider` interface allows a server-side external fallback.
- **Holders** (`holders.server.ts`): balances from Transfer logs since token creation, zero address excluded; metrics only when the index is complete.
- **Token identity** (`token-metadata.server.ts`): contract calls for name/symbol/decimals/supply; Flap `TokenCreated.meta` CID → bounded JSON fetch at `flap.mypinata.cloud` → image CID. Missing or invalid image data produces a generated fallback avatar, never a guessed logo. Results persist at `NEXA_TOKEN_METADATA_PATH`.
- **Positions** (`positions.server.ts`): confirmed receipt Transfer logs are the fill source. Pancake v2 reserve quotes update open positions in the centralized server tick; stale/missing prices suppress value and PnL.
