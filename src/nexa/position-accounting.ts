export interface AccountingState {
  quantityRaw: string;
  costBasisBnb: number;
  bnbSpent: number;
  gasBnb: number;
  entryGasBasisBnb?: number;
  realizedPnlGrossBnb?: number;
  realizedPnlBnb?: number;
}

export interface AccountingFill {
  side: "BUY" | "SELL";
  quantityRaw: string;
  bnbAmount?: number;
  gasBnb?: number;
}

/** Weighted-average cost basis. SELL PnL remains unavailable unless proceeds are verified. */
export function applyWeightedAverageFill(state: AccountingState, fill: AccountingFill): AccountingState {
  const quantity = BigInt(state.quantityRaw);
  const fillQuantity = BigInt(fill.quantityRaw);
  if (fillQuantity <= 0n) throw new Error("FILL_QUANTITY_INVALID");
  const gas = fill.gasBnb ?? 0;
  if (fill.side === "BUY") {
    if (fill.bnbAmount === undefined) throw new Error("BUY_COST_UNAVAILABLE");
    return {
      quantityRaw: (quantity + fillQuantity).toString(),
      costBasisBnb: state.costBasisBnb + fill.bnbAmount,
      bnbSpent: state.bnbSpent + fill.bnbAmount,
      gasBnb: state.gasBnb + gas,
      entryGasBasisBnb: (state.entryGasBasisBnb ?? 0) + gas,
      ...(state.realizedPnlGrossBnb !== undefined ? { realizedPnlGrossBnb: state.realizedPnlGrossBnb } : {}),
      ...(state.realizedPnlBnb !== undefined ? { realizedPnlBnb: state.realizedPnlBnb } : {}),
    };
  }
  if (fillQuantity > quantity) throw new Error("SELL_EXCEEDS_TRACKED_QUANTITY");
  const soldFraction = quantity > 0n ? Number(fillQuantity * 1_000_000_000n / quantity) / 1_000_000_000 : 0;
  const releasedCost = state.costBasisBnb * soldFraction;
  const releasedEntryGas = (state.entryGasBasisBnb ?? 0) * soldFraction;
  const remainingCost = Math.max(0, state.costBasisBnb - releasedCost);
  const realizedGross = fill.bnbAmount === undefined ? undefined : (state.realizedPnlGrossBnb ?? 0) + fill.bnbAmount - releasedCost;
  const realized = fill.bnbAmount === undefined ? undefined : (state.realizedPnlBnb ?? 0) + fill.bnbAmount - releasedCost - releasedEntryGas - gas;
  return {
    quantityRaw: (quantity - fillQuantity).toString(), costBasisBnb: remainingCost, bnbSpent: state.bnbSpent,
    gasBnb: state.gasBnb + gas, entryGasBasisBnb: Math.max(0, (state.entryGasBasisBnb ?? 0) - releasedEntryGas),
    ...(realizedGross !== undefined ? { realizedPnlGrossBnb: realizedGross } : {}), ...(realized !== undefined ? { realizedPnlBnb: realized } : {}),
  };
}