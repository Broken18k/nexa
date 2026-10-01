import { rpc, hexToNumber } from "./bsc-rpc.server";
import { padAddress, wordAddress, wordBig, selector, type Hex, ZERO_ADDRESS } from "./eth.server";

/** Verified from PancakeSwap developer docs (developer.pancakeswap.finance/contracts/v2/addresses). */
export const PANCAKE_V2_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73" as const;
export const PANCAKE_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E" as const;
export const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as const;
export const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955" as const;
const GET_PAIR = selector("getPair(address,address)");
const GET_RESERVES = selector("getReserves()");

export interface PriceQuote {
  token: Hex; pair: Hex; source: "pancake-v2-reserves"; blockNumber: number; observedAt: string;
  priceBnb: number; priceUsd?: number; liquidityBnb: number; marketCapUsd?: number; reserveToken: bigint; reserveWbnb: bigint;
}
export interface PricingProvider { quote(token: Hex, decimals: number, totalSupply?: bigint): Promise<PriceQuote | null>; }

const pairCache = new Map<string, { pair: Hex | null; at: number }>();
let bnbUsdCache: { value: number; at: number; observedAt: string; blockNumber: number } | undefined;

export async function findPair(token: string, quote: string = WBNB): Promise<Hex | null> {
  const key = `${token.toLowerCase()}-${quote.toLowerCase()}`;
  const cached = pairCache.get(key);
  if (cached && (cached.pair || Date.now() - cached.at < 60_000)) return cached.pair;
  const result = await rpc<string>("eth_call", [{ to: PANCAKE_V2_FACTORY, data: `${GET_PAIR}${padAddress(token)}${padAddress(quote)}` }, "latest"]);
  const pair = wordAddress(result.value, 0);
  const value = pair.toLowerCase() === ZERO_ADDRESS ? null : pair;
  pairCache.set(key, { pair: value, at: Date.now() });
  return value;
}
async function reserves(pair: string, token: string, quote: string) {
  const result = await rpc<string>("eth_call", [{ to: pair, data: GET_RESERVES }, "latest"]);
  const r0 = wordBig(result.value, 0), r1 = wordBig(result.value, 1);
  const tokenIsToken0 = token.toLowerCase() < quote.toLowerCase();
  return { token: tokenIsToken0 ? r0 : r1, quote: tokenIsToken0 ? r1 : r0 };
}

/** BNB/USD from the PancakeSwap v2 WBNB/USDT pair reserves; cached 15s. Both tokens use 18 decimals on BSC. */
export async function bnbUsd(): Promise<{ value: number; observedAt: string; blockNumber: number } | null> {
  if (bnbUsdCache && Date.now() - bnbUsdCache.at < 15_000) return bnbUsdCache;
  const pair = await findPair(WBNB, USDT_BSC);
  if (!pair) return null;
  const [res, block] = await Promise.all([reserves(pair, WBNB, USDT_BSC), rpc<string>("eth_blockNumber")]);
  if (res.token === 0n) return null;
  bnbUsdCache = { value: Number((res.quote * 10_000n) / res.token) / 10_000, at: Date.now(), observedAt: new Date().toISOString(), blockNumber: hexToNumber(block.value) };
  return bnbUsdCache;
}
export const bnbUsdFresh = () => Boolean(bnbUsdCache && Date.now() - bnbUsdCache.at < 60_000);

export const onchainPricing: PricingProvider = {
  async quote(token, decimals, totalSupply) {
    const pair = await findPair(token);
    if (!pair) return null;
    const [res, usd, block] = await Promise.all([reserves(pair, token, WBNB), bnbUsd(), rpc<string>("eth_blockNumber")]);
    if (res.token === 0n || res.quote === 0n) return null;
    const priceBnb = (Number(res.quote) / 1e18) / (Number(res.token) / 10 ** decimals);
    const liquidityBnb = (Number(res.quote) / 1e18) * 2;
    const supply = totalSupply !== undefined ? Number(totalSupply) / 10 ** decimals : undefined;
    return {
      token, pair, source: "pancake-v2-reserves", blockNumber: hexToNumber(block.value), observedAt: new Date().toISOString(), priceBnb, liquidityBnb, reserveToken: res.token, reserveWbnb: res.quote,
      ...(usd ? { priceUsd: priceBnb * usd.value } : {}), ...(usd && supply !== undefined ? { marketCapUsd: priceBnb * usd.value * supply } : {}),
    };
  },
};
