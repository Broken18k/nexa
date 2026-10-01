import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BSC_EXPLORER } from "@/nexa/config";
import { useNexaEvents } from "@/nexa/store";
import type { TokenIdentity as Identity, TokenRef } from "@/nexa/types";

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const initials = (token: TokenRef) => (token.symbol || token.name || token.address.slice(2, 4)).slice(0, 3).toUpperCase();
const age = (value?: string) => { if (!value) return "—"; const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000)); if (seconds < 60) return `${seconds}s`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`; return `${Math.floor(seconds / 86400)}d`; };
const money = (value?: number) => value === undefined ? "UNAVAILABLE" : value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `$${(value / 1_000).toFixed(1)}K` : `$${value.toFixed(4)}`;

export function TokenAvatar({ token, size = "md" }: { token: TokenRef & { imageUrl?: string }; size?: "sm" | "md" | "lg" }) {
  const [failed, setFailed] = useState(false);
  return <span className={`token-avatar token-avatar-${size}`} title={token.imageUrl && !failed ? "Verified Flap IPFS image" : "Generated fallback avatar"}>
    {token.imageUrl && !failed ? <img src={token.imageUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <b>{initials(token)}</b>}
  </span>;
}

export function TokenIdentityCompact({ token, identity, onOpen }: { token: TokenRef; identity?: Identity; onOpen?: (identity: Identity) => void }) {
  const content = <><TokenAvatar token={identity ?? token} size="sm" /><span className="token-copy"><strong>{token.symbol ? `$${token.symbol}` : "TOKEN"}</strong><small>{token.name ?? "Name unavailable"}</small><code>{short(token.address)}</code></span></>;
  return identity && onOpen ? <Button variant="ghost" className="token-compact" onClick={() => onOpen(identity)}>{content}</Button> : <span className="token-compact is-static">{content}</span>;
}

export function TokenDetailDrawer({ token, onClose }: { token: Identity | null; onClose: () => void }) {
  const events = useNexaEvents(); const relevant = token ? events.filter((event) => event.token?.address.toLowerCase() === token.address.toLowerCase() && event.type === "DECISION_CREATED").slice(0, 6) : [];
  return <Sheet open={Boolean(token)} onOpenChange={(open) => { if (!open) onClose(); }}><SheetContent className="token-sheet">
    <SheetHeader><SheetTitle>{token ? <span className="drawer-token"><TokenAvatar token={token} size="lg" /><span>{token.symbol ? `$${token.symbol}` : "TOKEN"}<small>{token.name ?? "Name unavailable"}</small></span></span> : "TOKEN"}</SheetTitle><SheetDescription>{token?.address ?? ""}</SheetDescription></SheetHeader>
    {token ? <div className="token-detail-body">
      <div className="token-facts">
        <span>CREATOR<strong>{token.creator ? short(token.creator) : "UNAVAILABLE"}</strong></span><span>AGE<strong>{age(token.createdAt ?? token.detectedAt)}</strong></span>
        <span>PRICE<strong>{token.priceBnb !== undefined ? `${token.priceBnb.toPrecision(6)} BNB` : "UNAVAILABLE"}</strong></span><span>MARKET CAP<strong>{money(token.marketCapUsd)}</strong></span>
        <span>LIQUIDITY<strong>{token.liquidityBnb !== undefined ? `${token.liquidityBnb.toFixed(2)} BNB` : "UNAVAILABLE"}</strong></span><span>HOLDERS<strong>{token.holders ?? "INDEXING / UNAVAILABLE"}</strong></span>
      </div>
      <div className="source-lines"><p>IDENTITY · {token.metadataSource.replaceAll("-", " ")} · {new Date(token.metadataObservedAt).toLocaleString()}</p>{token.pricing ? <p>PRICE · {token.pricing.source} · {new Date(token.pricing.observedAt).toLocaleString()}</p> : null}{token.holdersProvenance ? <p>HOLDERS · {token.holdersProvenance.source} · COMPLETE</p> : null}{token.imageSource ? <p>IMAGE · FLAP TOKENCREATED META CID → IPFS</p> : <p>IMAGE · GENERATED FALLBACK · NO OFFICIAL IMAGE RESOLVED</p>}</div>
      <div className="drawer-links"><Button asChild variant="outline"><a href={`${BSC_EXPLORER}/token/${token.address}`} target="_blank" rel="noreferrer">TOKEN <ExternalLink /></a></Button>{token.creator ? <Button asChild variant="outline"><a href={`${BSC_EXPLORER}/address/${token.creator}`} target="_blank" rel="noreferrer">CREATOR <ExternalLink /></a></Button> : null}</div>
      <div className="recent-decisions"><h3>RECENT NEXA DECISIONS</h3>{relevant.length ? relevant.map((event) => <article key={event.id}><time>{new Date(event.timestamp).toLocaleString()}</time><strong>{String(event.data["action"] ?? "DECISION")}</strong><p>{String(event.data["message"] ?? "")}</p></article>) : <p>NO DECISIONS IN THE CURRENT BOUNDED EVENT WINDOW</p>}</div>
    </div> : null}
  </SheetContent></Sheet>;
}