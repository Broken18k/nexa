import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BSC_EXPLORER } from "@/nexa/config";
import { useNexaSystem } from "@/nexa/store";
import type { PositionSnapshot, TokenIdentity } from "@/nexa/types";
import { TokenAvatar, TokenDetailDrawer, TokenIdentityCompact } from "./TokenIdentity";

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const age = (value: string) => { const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000)); return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`; };
const signed = (value?: number, suffix = " BNB") => value === undefined ? "PRICE UNAVAILABLE" : `${value >= 0 ? "+" : ""}${value.toFixed(6)}${suffix}`;

function PositionRow({ position, onToken }: { position: PositionSnapshot; onToken: (token: TokenIdentity) => void }) {
  return <article className="position-row">
    <div className="position-token"><TokenIdentityCompact token={position.token} identity={position.token} onOpen={onToken} /><span className={`position-state state-${position.status.toLowerCase()}`}>{position.status}</span></div>
    <div className="position-metrics"><span>SPENT<strong>{position.bnbSpent.toFixed(4)} BNB</strong></span><span>TOKENS<strong>{(Number(position.quantityRaw) / 10 ** (position.token.decimals ?? 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong></span><span>ENTRY<strong>{position.entryPriceBnb !== undefined ? position.entryPriceBnb.toPrecision(5) : "UNAVAILABLE"}</strong></span><span>VALUE<strong>{position.currentValueBnb !== undefined ? `${position.currentValueBnb.toFixed(5)} BNB` : "PRICE UNAVAILABLE"}</strong></span><span>UNREALIZED<strong className={(position.unrealizedPnlBnb ?? 0) >= 0 ? "pnl-up" : "pnl-down"}>{signed(position.unrealizedPnlBnb)}</strong></span><span>RETURN<strong>{position.unrealizedPnlPct !== undefined ? signed(position.unrealizedPnlPct, "%") : "PRICE UNAVAILABLE"}</strong></span><span>LIQUIDITY<strong>{position.liquidityBnb !== undefined ? `${position.liquidityBnb.toFixed(2)} BNB` : "UNAVAILABLE"}</strong></span><span>HOLDERS<strong>{position.holders ?? "INDEXING"}</strong></span></div>
    <div className="position-rationale"><strong>{position.currentDecision ?? "DECISION UNAVAILABLE"}</strong><p>{position.rationale ?? "Awaiting a verified position decision."}</p><time>OPEN {age(position.openedAt)} · {new Date(position.openedAt).toLocaleString()}</time><Button asChild variant="ghost" size="icon" title="Open confirmed entry transaction"><a href={`${BSC_EXPLORER}/tx/${position.entryTxHash}`} target="_blank" rel="noreferrer"><ExternalLink /></a></Button></div>
    <p className="position-source">{position.pricing ? `PRICE · ${position.pricing.source} · ${new Date(position.pricing.observedAt).toLocaleTimeString()}` : "PRICE UNAVAILABLE · PNL SUPPRESSED"} · GAS {position.gasBnb.toFixed(6)} BNB</p>
  </article>;
}

export function PositionsPanel() {
  const { openPositions, closedPositions, dryRunIntents } = useNexaSystem(); const [token, setToken] = useState<TokenIdentity | null>(null);
  return <>
    <section className="data-section positions-live-section"><div className="section-title"><span>01</span><h2>OPEN POSITIONS</h2><small>{openPositions.length ? `${openPositions.length} CONFIRMED ONCHAIN` : "CONFIRMED FILLS ONLY"}</small></div>
      {openPositions.length ? <div className="positions-list">{openPositions.map((position) => <PositionRow key={position.positionId} position={position} onToken={setToken} />)}</div> : <div className="positions-empty"><strong>NO VERIFIED OPEN POSITIONS</strong><p>A position appears only after a live BUY confirms and the receipt proves tokens reached the NEXA wallet.</p></div>}
      {dryRunIntents.length ? <div className="dry-run-list"><h3>SIMULATED / DRY-RUN INTENTS · NON-BROADCAST</h3>{dryRunIntents.map((intent) => <div key={intent.intentId}><TokenIdentityCompact token={intent.token} /><span>{intent.amountBnb} BNB</span><strong>{intent.status.replaceAll("_", " ")}</strong></div>)}</div> : null}
    </section>
    <section className="data-section history-section"><div className="section-title"><span>02</span><h2>HISTORY / CLOSED POSITIONS</h2><small>WEIGHTED AVERAGE COST BASIS</small></div>{closedPositions.length ? <div className="history-list">{closedPositions.map((position) => <div key={position.positionId}><TokenAvatar token={position.token} size="sm" /><strong>{position.token.symbol ? `$${position.token.symbol}` : short(position.token.address)}</strong><span>{new Date(position.openedAt).toLocaleDateString()} → {position.closedAt ? new Date(position.closedAt).toLocaleDateString() : "—"}</span><b>{signed(position.realizedPnlBnb)}</b><span>{position.closedAt ? age(position.openedAt) : "—"}</span><a href={`${BSC_EXPLORER}/tx/${position.entryTxHash}`} target="_blank" rel="noreferrer">BUY <ExternalLink /></a>{position.lastExitTxHash ? <a href={`${BSC_EXPLORER}/tx/${position.lastExitTxHash}`} target="_blank" rel="noreferrer">SELL <ExternalLink /></a> : null}</div>)}</div> : <div className="empty-line">NO CLOSED POSITIONS <span>—</span></div>}</section>
    <TokenDetailDrawer token={token} onClose={() => setToken(null)} />
  </>;
}