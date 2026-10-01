# Flap — Pre-Migration Bonding-Curve Trading on BSC (Research Notes)

Research date: 2026 (live docs + two decoded BSC mainnet transactions). All addresses/selectors below are either copied verbatim from Flap's official docs or independently recomputed/verified against raw on-chain transaction data pulled via a public BSC RPC node. Items I could not fully verify are flagged under "Unresolved / ambiguous" at the end.

## 1. Core contracts (BNB Chain mainnet)

Single entrypoint pattern: almost everything (quote, swap, launch, inspect) goes through **Portal**.

| Name | Address | Notes / source |
|---|---|---|
| **Portal** (trading + launch entrypoint) | `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0` | Current doc version tag v5.23.1 [1](https://docs.flap.sh/flap/developers/deployed-contract-addresses) |
| Older "Launchpad" contract referenced by 3rd-party indexer (Bitquery) | `0x1de460f363AF910f51726DEf188F9004276Bf4bc` | Still receives traffic on-chain (legacy "Swap" entrypoint; forwards into current Portal `0xe2cE...9De0`, confirmed by internal-transfer trace on a live tx) [2](https://docs.bitquery.io/docs/blockchain/BSC/flap-sh/) |
| Standard Token Impl | `0x8b4329947e34b6d56d71a3385cac122bade7d78d` | Vanity suffix 8888 |
| Tax Token V3 Impl | `0x024f18294970B5c76c0691b87f138A0317156422` | Vanity suffix 7777, recommended for new tax-token launches |
| Standard Token V3 Impl | `0x88881b6f03090462a969eC7f48385744Eeb63333` | Non-tax, CL-migration path |
| VaultPortal | `0x90497450f2a706f1951b5bdda52B4E5d16f34C06` | Tax-vault registration/management |
| Tax Token Helper | `0x53841c73217735F37BC1775538b03b23feFD8346` | Read dynamic tax-token stats |
| Trigger Service | `0xcf4EE25035CF883895110f367F5BA8172416a7F9` | Automation/keeper service |
| AI Oracle | `0xaEe3a7Ca6fe6b53f6c32a3e8407eC5A9dF8B7E39` | Preview feature |

All addresses: [Deployed Contract Addresses](https://docs.flap.sh/flap/developers/deployed-contract-addresses) [1](https://docs.flap.sh/flap/developers/deployed-contract-addresses).

Flap also deploys the identical Portal pattern on Robinhood Chain, Base, Toshimart, X Layer, Muffun, Monad, plus BSC/Robinhood testnets — each with its own Portal address (see source doc) [1](https://docs.flap.sh/flap/developers/deployed-contract-addresses).

## 2. Bonding curve mechanism (pre-migration)

- Constant-product curve: `(1e9 + h − s) * (reserve + r) = k`, where `s` = circulating supply, `reserve` = quote-asset reserve held by the curve, and `(r, h, k)` are per-token curve constants set at launch (`TokenCurveSet` / `TokenCurveSetV2` events). Legacy curve is the special case `h = 0, k = r * 1e9` [3](https://docs.flap.sh/flap/developers/basic-and-mechanism/bonding-curve).
- Max total supply fixed at 1,000,000,000 tokens per token; all supply starts inside the Portal/bonding-curve contract and is "minted out" to buyers as the curve advances [3](https://docs.flap.sh/flap/developers/basic-and-mechanism/bonding-curve).
- `estimateSupply(reserve) = 1e9 + h − k/(r+reserve)`; `estimateReserve(supply) = k/(h+1e9−supply) − r`; `price(supply) = k/(h+1e9−supply)^2` — official Solidity `LibCurve` reference implementation reproduced in docs [4](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/trade-tokens).
- Quote asset can be the chain's native gas token (BNB) or an ERC-20 (e.g. USD1). Buying with native gas into a non-native-quote token is supported only when `nativeToQuoteSwap` is enabled for that quote token (internally routes BNB→quote via PancakeSwap first) [4](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/trade-tokens).

## 3. Lifecycle / migration thresholds

- Each token graduates off the curve once circulating supply hits `dexSupplyThresh` (event `TokenDexSupplyThreshSet`; default ≈ 6.67e8 ether if not emitted, but current BSC default observed is 800M) [5](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/index-token-created-events).
- Historical BSC migration thresholds (quote = BNB) [6](https://docs.flap.sh/flap/developers/basic-and-mechanism/list-on-dex):

| Deployment era | Circulating supply | Reserve |
|---|---|---|
| Legacy, before block 42042177 | 800M | 30.1 BNB |
| Legacy, from block 42042177 | 800M | 16 BNB |
| From block 47855189 to before 51314696 | 800M | 8 "ETH" (BNB) |
| After [block 51314696](https://bscscan.com/block/51314696) | 800M | 16 BNB / 10,000 USD1 |

- On migration, remaining (non-circulating) supply + full reserve are added as DEX liquidity. Non-tax tokens try Uniswap-V3-style (PancakeSwap V3) concentrated liquidity first (range: low = initial curve price, high = 10,000× last curve price), falling back to V2-style if not viable. **Tax tokens can only migrate to Uniswap V2 / its forks** [6](https://docs.flap.sh/flap/developers/basic-and-mechanism/list-on-dex).
- `TokenStatus` enum: `Invalid, Tradable, InDuel (obsolete), Killed (obsolete), DEX[, Staged]` — only `Tradable` tokens can use `swapExactInput`/`buy`/`sell`; `DEX` tokens have graduated [7](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/bonding-curve-in-developers-perspective), [8](https://github.com/flap-builder/flap-skills/blob/main/skill.sol).
- `TokenKilled` / `TokenNotTradable` are explicit revert errors guarding trades against killed or non-tradable tokens (from Portal source excerpt in docs) [4](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/trade-tokens).

## 4. Trading surface (current, unified API)

### 4.1 Read: quote
```solidity
struct QuoteExactInputParams {
    address inputToken;   // address(0) = native gas asset
    address outputToken;  // address(0) = native gas asset
    uint256 inputAmount;
}
function quoteExactInput(QuoteExactInputParams calldata params) external returns (uint256 outputAmount);
```
Not a `view` function, but has no state-changing side effects usable via `eth_call`/simulation — docs explicitly say "we don't need to send a transaction to get the quote" [4](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/trade-tokens).

Scenario matrix (native-quote tokens, e.g. BNB):
- Buy: `inputToken=0x0`, `outputToken=<token>`
- Sell: `inputToken=<token>`, `outputToken=0x0`

Scenario matrix (ERC-20 quote, e.g. USD1):
- Buy with USD1: `inputToken=<USD1>`, `outputToken=<token>`
- Buy with native (only if `nativeToQuoteSwap` enabled for that quote token): `inputToken=0x0`, `outputToken=<token>` (Portal auto-swaps BNB→USD1 via PancakeSwap internally)
- Sell to USD1: `inputToken=<token>`, `outputToken=<USD1>`
(all per [4](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/trade-tokens))

Legacy read-only preview functions also exist (`previewBuy(token, eth)`, `previewSell(token, amount)`, `previewRedeem(...)`), plus `getTokenV5`/`getTokenV6`/`getTokenV7` state getters returning curve params, reserve, supply, price, status, dexSupplyThresh, quote token, tax rate, pool, progress, etc. [9](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/bonding-curve-in-developers-perspective).

### 4.2 Write: swap (current unified entrypoint)
```solidity
struct ExactInputParams {
    address inputToken;      // address(0) = native asset
    address outputToken;     // address(0) = native asset
    uint256 inputAmount;
    uint256 minOutputAmount; // slippage floor
    bytes   permitData;      // optional EIP-2612 permit to skip a separate approve() tx
}
function swapExactInput(ExactInputParams calldata params) external payable returns (uint256 outputAmount);
```
Selector: **`0xef7ec2e7`** — independently recomputed as `keccak256("swapExactInput((address,address,uint256,uint256,bytes))")[:4]` and matches the 4-byte prefix of two live, successful BSC transactions decoded below. Current docs: [4](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/trade-tokens).

There is also an extension-aware variant:
```solidity
struct ExactInputV3Params {
    address inputToken;
    address outputToken;
    uint256 inputAmount;
    uint256 minOutputAmount;
    bytes   permitData;
    bytes   extensionData; // extension-specific payload, see extension docs
}
```
(`IPortalTradeV2` interface, from Flap's own llms-full export) [10](https://docs.flap.sh/flap/llms-full.txt).

Legacy (pre-unification) trading methods are still present for backward compatibility:
```solidity
function buy(address token, address recipient, uint256 minAmount) external payable returns (uint256 amount);
function sell(address token, uint256 amount, uint256 minEth) external returns (uint256 eth);
function buyOnCreation(address token, address recipient, uint256 inputAmount) external payable returns (uint256 amount); // used only at launch, no slippage check
function redeem(address srcToken, address dstToken, uint256 srcAmount) external returns (uint256 dstAmount); // for killed tokens only
```
[10](https://docs.flap.sh/flap/llms-full.txt)

### 4.3 Approvals / permit / slippage / deadline / referrer

- **Approvals**: selling an ERC-20 (the launched token or an ERC-20 quote asset) normally requires a standard `approve(portal, amount)` beforehand, exactly like any ERC-20 spender pattern. Flap optimizes this away for sells via the `permitData` field of `ExactInputParams`: an ABI-encoded EIP-2612 `Permit` (owner, spender, value, deadline, v, r, s) that the token (which implements `permit`) consumes inside the same transaction, avoiding a separate `approve` tx [4](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/trade-tokens). Buys with native BNB need no approval (sent as `msg.value`); buys with an ERC-20 quote asset still need a normal `approve`.
- **Slippage**: enforced purely via `minOutputAmount` (buy) / `minAmount`,`minEth` (legacy buy/sell). Revert path: `error SlippageTooHigh(uint256 actualAmount, uint256 minAmount)` [10](https://docs.flap.sh/flap/llms-full.txt). `buyOnCreation` explicitly does **not** check slippage (doc comment: "the slippage is not checked in this function") [10](https://docs.flap.sh/flap/llms-full.txt).
- **Deadline**: there is **no transaction-level deadline parameter** on `swapExactInput`/`ExactInputParams`/`ExactInputV3Params` in current docs or the decoded calldata — the only "deadline" concept in the trading flow is the EIP-2612 permit's own `deadline` field (part of `permitData`), which only bounds the validity of the signed approval, not of the swap execution itself [4](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/trade-tokens).
- **Referrer**: no referrer/affiliate parameter exists anywhere in the current quote/swap structs (`QuoteExactInputParams`, `ExactInputParams`, `ExactInputV3Params`) per official docs and the live calldata decoded below. (Flap has a separate, unrelated "commission receiver" concept for Tax Token V3 vaults, which is a token-tax feature set at launch, not a trade-time referral param — see §5.) Treat "no referrer support in direct Portal swaps" as current but see Unresolved section.
- Other guard errors seen in source excerpts: `SameToken(address)` (input==output), `TokenNotFound(address)`, `AmountTooSmall(uint256)`, `TokenKilled(address)`, `TokenNotTradable(address)`, `MultiDexRouterCannotBeZero()` [10](https://docs.flap.sh/flap/llms-full.txt).

## 5. Fees

Per Flap's protocol-economics page [11](https://docs.flap.sh/flap/developers/basic-and-mechanism/protocol-economics):

- **Bonding-curve trading fee**: 1% of trade amount on every buy/sell against the curve, on BNB Chain (also Robinhood, X Layer, Monad); 2.5% on Morph. Applies only pre-migration; stops once the token graduates to DEX.
- **Tax-token protocol fee**: up to an additional 0.3% of trade volume for tax tokens only, to fund automated tax collection/settlement infra, independent of the token creator's own configured tax rate (1/3/5/10%). Exact on-chain value is "publicly verifiable in the protocol contract" (not restated as a literal number in docs) — see Unresolved section.
- Fee accounting is visible directly in the `TokenBought`/`TokenSold` events' `fee` field (see §6).

## 6. Events (trade + lifecycle)

From `trade-tokens` and `token-migration` docs [4](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/trade-tokens), [12](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/token-migration):

```solidity
event TokenBought(uint256 ts, address token, address buyer, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice);
event TokenSold(uint256 ts, address token, address seller, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice);
event LaunchedToDEX(address token, address pool, uint256 amount, uint256 eth);
event FlapTokenCLPoolCreated(address token, bytes32 poolId, uint160 sqrtPriceX96); // only for PCS Infinity CL / Uniswap v4 migrations
event FlapTokenProgressChanged(address token, uint256 newProgress); // wad, since v4.12.1
```
Also referenced for off-chain quoting/indexing: `TokenCreated`, `TokenCurveSet`/`TokenCurveSetV2`, `TokenDexSupplyThreshSet`, `FlapTokenCirculatingSupplyChanged`, `FlapTokenTaxSet`, `FlapTokenAsymmetricTaxSet`, `TokenQuoteSet`, `TokenMigratorSet`, `TokenVersionSet`, `TokenDexPreferenceSet` [5](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/index-token-created-events).

`LaunchedToDEX.pool` semantics depend on migrator type — only `V2_MIGRATOR`/`V3_MIGRATOR` give a real pool/pair address directly; for `V4_UNI_MIGRATOR`/`PCS_INFINITY_CL_MIGRATOR`, `pool` is a router-level address (PoolManager / Infinity vault) and the **real** pool id must be read from `FlapTokenCLPoolCreated.poolId` [12](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/token-migration).

## 7. Decoded live BSC transactions (independent verification)

Fetched directly via public BSC JSON-RPC (`bsc-dataseed.binance.org`), not just BscScan UI text, so calldata/logs are raw and independently decodable.

### Tx A — sell, confirmed selector + logs
- Hash: `0xab0b30f6b5a7cd9374292de177d6231ef01641211cc4de3b248230efb657533d`, block `0x6cb8ab1`, status success [13](https://bscscan.com/tx/0xab0b30f6b5a7cd9374292de177d6231ef01641211cc4de3b248230efb657533d)
- `to`: `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0` (Portal)
- `input`: `0xef7ec2e7` + ABI-encoded `ExactInputParams`:
  - `inputToken = 0x1694481544e88ea612289a8ba808a9cebe3c7777` (the launched token)
  - `outputToken = 0x0000000000000000000000000000000000000000` (native BNB)
  - `inputAmount = 0x185aa45edd877e0b30cd` ≈ 115,008.846703149380743373 tokens
  - `minOutputAmount = 0`
  - `permitData` offset present, length 0 (empty bytes)
- Selector independently recomputed as `keccak256("swapExactInput((address,address,uint256,uint256,bytes))")[:4] = 0xef7ec2e7` — **exact match**.
- Logs confirm: ERC-20 `Transfer(seller→Portal, 115,008.8467...)` on the token contract; a `FlapTokenCirculatingSupplyChanged(token, newSupply)` log from address `0xe2cE6ab8...9De0` whose topic0 `0x115c78ad17c4763fb97bca94f3e59dc8cb2e59c9d3862f24a694ec401200f562` matches `keccak256("FlapTokenCirculatingSupplyChanged(address,uint256)")` exactly (independently recomputed) — confirms this is the live Portal and that `FlapTokenCirculatingSupplyChanged` is live/real, not just doc vaporware.
- WBNB `Transfer`/`Withdrawal` logs confirm BNB proceeds routed back to the seller net of a small fee skim to a separate fee-receiver address (`0x8a08D98C...3D8A7aB0E` appears repeatedly across multiple Flap txs as a protocol fee receiver — pattern, not officially documented address name).

### Tx B — buy, native BNB in
- Hash: `0xbb0ce52968674b481e2c480e2590e5a2c667d9b38e3d63fc1b92e07ba0ab266b`, block `0x6ded38d`, status success [14](https://bscscan.com/tx/0xbb0ce52968674b481e2c480e2590e5a2c667d9b38e3d63fc1b92e07ba0ab266b)
- `to`: Portal, `value = 0x27147114878000` wei (0.011 BNB), matching BscScan's displayed "Value: 0.011 BNB"
- `input`: `0xef7ec2e7` + `ExactInputParams`:
  - `inputToken = 0x0` (native)
  - `outputToken = 0x2bc242059c716d2f6992c9e85b06d891e8b57777` (purchased token)
  - `inputAmount = 0x27147114878000` = 0.011 ether (matches `msg.value`)
  - `minOutputAmount = 0x3c71d072107eef64b9d1` (explicit non-zero slippage floor set by this buyer)
  - empty `permitData`
- BscScan's own decoded label for both txs independently corroborates: "Call Swap Exact Input Function ... on `0xe2cE6ab8...8e65C9De0`" [13](https://bscscan.com/tx/0xab0b30f6b5a7cd9374292de177d6231ef01641211cc4de3b248230efb657533d), [14](https://bscscan.com/tx/0xbb0ce52968674b481e2c480e2590e5a2c667d9b38e3d63fc1b92e07ba0ab266b).
- Also found: a third tx hitting the legacy router address `0x1de460f363AF910f51726DEf188F9004276Bf4bc` labeled "Call Swap Function," whose internal transfers show it forwarding into the current Portal (`0xe2cE6ab8...9De0`) and the standard fee-receiver `0x8a08D98C...3D8A7aB0E` — consistent with it being a legacy/compat entrypoint rather than the primary one [15](https://bscscan.com/tx/0xe358a0ff0975851a0097f713dfe67c47410f9e5c52313b898e54a4644601d8d1).

## 8. Unresolved / ambiguous — needs further verification

1. **BscScan contract verification not independently confirmed in this pass.** The BscScan public API (`api.bscscan.com`) rejected unauthenticated/placeholder-key requests ("Missing/Invalid API Key") and the modern `api.etherscan.io/v2` endpoint likewise required a real key; no BSCSCAN/Etherscan API key was available in this sandbox. I therefore could not pull the verified Solidity source / full ABI JSON directly from BscScan for `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0`. All function/struct signatures above come from Flap's own docs plus independent selector/topic recomputation against raw calldata/logs pulled from a public RPC node — strong but not identical to "BscScan-verified source" confirmation. Recommend re-running with a valid BscScan API key to pull `getsourcecode`/`getabi` directly.
2. **`TokenSold` event topic0 did not match the documented signature.** I recomputed `keccak256("TokenSold(uint256,address,address,uint256,uint256,uint256,uint256)")` = `0x03a4693e...`, but the actual Portal-emitted log in Tx A has topic0 `0xb4aa5d6b2390b2b8892ff84cb0ef9a64e969e1af22d049fa61cc2cf66c6ab7bd`, which none of several plausible reorderings matched either. This means the **currently live Portal's actual sell-event ABI differs from what's published in the current `trade-tokens` doc page** (possibly an additional/renamed field, e.g. an extra `quoteToken` address or different param count in the production build vs. docs snapshot). Needs ABI from verified BscScan source to resolve precisely.
3. **Referrer parameter**: confirmed absent from all quote/swap structs in current docs and in two decoded live calldata samples, but Flap's docs explicitly describe a "Commission Receiver" feature for Tax Token V3 vaults — it's unclear whether any currently-live Portal swap path (e.g. extension-aware `ExactInputV3Params.extensionData`) can be used to attach a referral/commission beneficiary at trade time. Flagged as open.
4. **Exact numeric tax-token protocol fee rate** (said to be "up to 0.3%") is not given as a single fixed percentage in docs — docs explicitly punt to "publicly verifiable in the protocol contract," which requires the verified ABI/source (see item 1) to pin down exactly.
5. **Legacy Launchpad contract `0x1de460f363AF910f51726DEf188F9004276Bf4bc`** is not listed in Flap's current official "Deployed Contract Addresses" page, only in a third-party (Bitquery) doc and in live transaction traces; its exact relationship to current Portal (proxy admin? deprecated front door? permanently supported?) is inferred from trace behavior, not an official statement.
6. **Quote-function gas-free usage caveat**: docs say `quoteExactInput` is non-view but callable via `eth_call`; this was not independently re-verified by simulation in this pass (no RPC `eth_call` test was run against it), so treat as doc-stated rather than independently reproduced.

## Sources
1. [Deployed Contract Addresses](https://docs.flap.sh/flap/developers/deployed-contract-addresses)
2. [Bitquery — Flap.sh API docs](https://docs.bitquery.io/docs/blockchain/BSC/flap-sh/)
3. [Bonding Curve](https://docs.flap.sh/flap/developers/basic-and-mechanism/bonding-curve)
4. [Trade Tokens](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/trade-tokens)
5. [Index Token Created Events](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/index-token-created-events)
6. [Migrated To DEX](https://docs.flap.sh/flap/developers/basic-and-mechanism/list-on-dex)
7. [Bonding Curve In Developers' Perspective](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/bonding-curve-in-developers-perspective)
8. [flap-builder/flap-skills skill.sol (GitHub)](https://github.com/flap-builder/flap-skills/blob/main/skill.sol)
9. [Bonding Curve In Developers' Perspective (getTokenV5)](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/bonding-curve-in-developers-perspective)
10. [Flap llms-full.txt (full doc export, IPortalTradeV2 / errors)](https://docs.flap.sh/flap/llms-full.txt)
11. [protocol-economics](https://docs.flap.sh/flap/developers/basic-and-mechanism/protocol-economics)
12. [Token Migration](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/token-migration)
13. [BscScan Tx 0xab0b30f6...](https://bscscan.com/tx/0xab0b30f6b5a7cd9374292de177d6231ef01641211cc4de3b248230efb657533d)
14. [BscScan Tx 0xbb0ce529...](https://bscscan.com/tx/0xbb0ce52968674b481e2c480e2590e5a2c667d9b38e3d63fc1b92e07ba0ab266b)
15. [BscScan Tx 0xe358a0ff... (legacy router)](https://bscscan.com/tx/0xe358a0ff0975851a0097f713dfe67c47410f9e5c52313b898e54a4644601d8d1)
