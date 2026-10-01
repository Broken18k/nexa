import { memo, useEffect, useRef, useState } from "react";
import { ExternalLink, Play, ShieldAlert, Square } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BSC_EXPLORER } from "@/nexa/config";
import { deriveReceipts, deriveStrategy, replayFrames, type DecisionReceipt } from "@/nexa/derive";
import { useNexaEvents, useNexaSystem } from "@/nexa/store";
import type { NexaEvent } from "@/nexa/types";

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const label = (value: string) => value.replaceAll("_", " ");

export const ProtectionBanner = memo(function ProtectionBanner() {
  const { protection } = useNexaSystem();
  if (protection.state !== "PROTECTING_CAPITAL") return null;
  return <div className="protect-banner" role="status"><ShieldAlert /><strong>PROTECTING CAPITAL</strong><span>EXECUTION PAUSED</span><div>{protection.reasons.map((reason) => <code key={reason}>{reason}</code>)}</div></div>;
});

export const AutonomyCounters = memo(function AutonomyCounters() {
  const { counters } = useNexaSystem();
  const items: [string, number][] = [["AUTONOMOUS ACTIONS", counters.autonomousActions], ["HUMAN ACTIONS", counters.humanActions], ["DECISIONS", counters.decisions], ["BLOCKED BY POLICY", counters.blockedByPolicy], ["CONFIRMED TX", counters.confirmedTx], ["MEMORIES", counters.memories]];
  return <div className="metric-strip autonomy-strip">{items.map(([name, value]) => <div key={name} className={name === "AUTONOMOUS ACTIONS" ? "is-key" : ""}><span>{name}</span><strong>{value}</strong></div>)}</div>;
});

export const LiveStrategy = memo(function LiveStrategy() {
  const strategy = deriveStrategy(useNexaEvents());
  return <section className="strategy-panel">
    <div className="panel-heading"><span>LIVE STRATEGY</span><small>{strategy.latest ? `PRIORITY · ${strategy.priority}` : "NO VERIFIED ANALYSIS YET"}</small></div>
    <div className="signal-grid">{strategy.signals.map((signal) => <span key={signal.family} className={signal.active ? "signal-on" : ""} title={signal.reason ?? "Inactive: no supporting real analysis"}><i />{label(signal.family)}{signal.value !== undefined ? <b>{signal.value}</b> : null}</span>)}</div>
    <p className="strategy-note">{strategy.reasonCodes.length ? strategy.reasonCodes.map(label).join(" · ") : "Signals activate only from real token snapshots. Awaiting verified pair/holder data."}</p>
  </section>;
});

export function ReplayPanel() {
  const events = useNexaEvents();
  const [playing, setPlaying] = useState<NexaEvent[] | null>(null);
  const [index, setIndex] = useState(0);
  const [blocks, setBlocks] = useState(0);
  const raf = useRef(0);
  const start = () => {
    const { frames, blocks: count } = replayFrames(events);
    setBlocks(count); setIndex(0); setPlaying(frames);
  };
  useEffect(() => {
    if (!playing) return;
    const duration = 10_000; const began = performance.now();
    const step = (now: number) => {
      if (document.hidden) { raf.current = requestAnimationFrame(step); return; }
      const progress = Math.min(1, (now - began) / duration);
      setIndex(Math.floor(progress * Math.max(1, playing.length)));
      if (progress < 1) raf.current = requestAnimationFrame(step); else setTimeout(() => setPlaying(null), 900);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);
  return <div className="replay">
    <button type="button" className="replay-btn" onClick={playing ? () => setPlaying(null) : start}>{playing ? <Square /> : <Play />}{playing ? "STOP REPLAY" : "REPLAY LAST 60 SECONDS"}</button>
    {playing ? <div className="replay-stage" aria-live="polite">
      <div className="replay-bar"><i style={{ transform: `scaleX(${playing.length ? index / playing.length : 1})` }} /></div>
      {playing.length ? playing.slice(Math.max(0, index - 3), index + 1).map((event) => <div className="replay-frame" key={event.id}><time>{new Date(event.timestamp).toLocaleTimeString([], { hour12: false })}</time><strong>{label(event.type)}</strong><span>{event.token?.symbol ?? String(event.data["message"] ?? "")}</span></div>)
        : <div className="replay-frame"><strong>No recent onchain activity to replay.</strong><span>{blocks ? `${blocks} block heartbeats only` : ""}</span></div>}
      {playing.length && blocks ? <small>+ {blocks} block observations aggregated</small> : null}
    </div> : null}
  </div>;
}

export function ReceiptDrawer({ receipt, onClose }: { receipt: DecisionReceipt | null; onClose: () => void }) {
  return <Sheet open={Boolean(receipt)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="receipt-sheet">
      <SheetHeader><SheetTitle>DECISION RECEIPT</SheetTitle><SheetDescription>{receipt ? receipt.decisionId : ""}</SheetDescription></SheetHeader>
      {receipt ? <ol className="receipt-steps">{receipt.events.map((event) => <li key={event.id}>
        <strong>{label(event.type)}</strong><time>{new Date(event.timestamp).toLocaleString()}</time>
        <p>{String(event.data["message"] ?? "")}</p>
        {Array.isArray(event.data["reasonCodes"]) ? <code>{(event.data["reasonCodes"] as string[]).join(" · ")}</code> : null}
        {event.blockNumber ? <span>BLOCK {event.blockNumber.toLocaleString()}</span> : null}
        {event.txHash ? <a href={`${BSC_EXPLORER}/tx/${event.txHash}`} target="_blank" rel="noreferrer">{short(event.txHash)} <ExternalLink /></a> : null}
        {event.contractAddress ? <a href={`${BSC_EXPLORER}/address/${event.contractAddress}`} target="_blank" rel="noreferrer">{short(event.contractAddress)} <ExternalLink /></a> : null}
      </li>)}</ol> : null}
    </SheetContent>
  </Sheet>;
}

export function LatestReceipt() {
  const receipts = deriveReceipts(useNexaEvents());
  const [open, setOpen] = useState<DecisionReceipt | null>(null);
  const latest = receipts[0];
  return <>
    <button type="button" className="receipt-btn" disabled={!latest} onClick={() => latest && setOpen(latest)}>
      <span>LATEST DECISION RECEIPT</span><strong>{latest ? `${latest.token?.symbol ?? short(latest.decisionId)} · ${latest.events.length} STEPS` : "NO EXECUTABLE ACTIONS YET"}</strong>
    </button>
    <ReceiptDrawer receipt={open} onClose={() => setOpen(null)} />
  </>;
}

export const IntegrationBar = memo(function IntegrationBar() {
  const { integrations, readiness, executionMode } = useNexaSystem();
  const ready = readiness.filter((check) => check.ok).length;
  return <div className="integration-bar">
    {Object.entries(integrations).map(([name, status]) => <span key={name} className={`integ integ-${status.state}`} title={`${status.detail}${status.missing?.length ? ` · missing: ${status.missing.join(", ")}` : ""}`}><i />{name}</span>)}
    <strong className="integ-mode">{executionMode.replaceAll("_", " ")} · {ready}/{readiness.length || "—"} READY</strong>
  </div>;
});

export const ReadinessChecklist = memo(function ReadinessChecklist() {
  const { readiness, integrations, signerAddress } = useNexaSystem();
  const missing = [...new Set(Object.values(integrations).flatMap((status) => status.missing ?? []))];
  return <div className="readiness">
    <ol>{readiness.map((check) => <li key={check.id} className={check.ok ? "ready-ok" : "ready-fail"}><i>{check.ok ? "✓" : "✕"}</i><strong>{check.id.replaceAll("_", " ")}</strong><span>{check.detail}</span></li>)}</ol>
    {signerAddress ? <p className="readiness-note">Signer public address: <code>{signerAddress}</code></p> : null}
    {missing.length ? <p className="readiness-note">Config needed: {missing.map((name) => <code key={name}>{name}</code>)}</p> : null}
  </div>;
});
