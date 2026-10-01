import { ExternalLink, ShieldCheck, Terminal, Wallet } from "lucide-react";
import { BSC_EXPLORER } from "@/nexa/config";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useNexaEvents, useNexaSystem } from "@/nexa/store";
import { deriveReceipts, type DecisionReceipt } from "@/nexa/derive";
import { ReadinessChecklist, ReceiptDrawer } from "./AutonomyPanels";
import { PositionsPanel } from "./PositionsPanel";
import { TokenDetailDrawer, TokenIdentityCompact } from "./TokenIdentity";
import type { TokenIdentity } from "@/nexa/types";
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
export function DashboardSections() {
  const system = useNexaSystem(); const events = useNexaEvents();
  const [receipt, setReceipt] = useState<DecisionReceipt | null>(null);
  const [tokenDetail, setTokenDetail] = useState<TokenIdentity | null>(null);
  const receipts = deriveReceipts(events);
  const outcomes = events.filter((event) => event.type === "OUTCOME_RECORDED").slice(0, 4);
  const riskChanges = events.filter((event) => event.type === "RISK_POLICY_UPDATED").slice(0, 3);
  const lastBlocked = events.find((event) => event.type === "TRADE_BLOCKED");
  const lastAction = events.find((event) => event.type === "TX_CONFIRMED");
  const awareness: [string, string][] = [
    ["BNB BALANCE", system.walletConfigured ? `${system.walletBalanceBnb ?? "—"} BNB` : "CONFIG REQUIRED"], ["OPEN POSITIONS", String(system.openPositions.length)],
    ["REALIZED PNL", system.closedPositions.some((item) => item.realizedPnlBnb !== undefined) ? `${system.closedPositions.reduce((sum, item) => sum + (item.realizedPnlBnb ?? 0), 0).toFixed(6)} BNB` : "UNAVAILABLE · NO CLOSED FILLS"], ["UNREALIZED PNL", system.openPositions.length && system.openPositions.every((item) => item.unrealizedPnlBnb !== undefined) ? `${system.openPositions.reduce((sum, item) => sum + (item.unrealizedPnlBnb ?? 0), 0).toFixed(6)} BNB` : "UNAVAILABLE · NO VERIFIED PRICING"], ["TODAY PNL", "UNAVAILABLE · NO VERIFIED CLOSED FILLS"], ["TOTAL EXPOSURE", `${system.openPositions.reduce((sum, item) => sum + item.costBasisBnb, 0).toFixed(4)} BNB`],
    ["RISK STATE", system.protection.state.replace("_", " ")], ["RISK MULTIPLIER", `${system.riskMultiplier}× (BOUNDED 0.25–1)`],
    ["SELF TOKEN", system.selfToken ? (system.selfToken.symbol ?? short(system.selfToken.address)) : "NOT DETECTED"], ["SELF HOLDERS", system.selfToken?.holders !== undefined ? String(system.selfToken.holders) : "UNAVAILABLE · INDEX INCOMPLETE"],
    ["LAST ACTION", lastAction?.txHash ? short(lastAction.txHash) : "NONE"], ["LAST BLOCKED", lastBlocked ? String(lastBlocked.data["message"] ?? "BLOCKED") : "NONE"],
  ];
  return <div className="below-grid">
    <PositionsPanel />
    <section className="data-section activity-section"><div className="section-title"><span>03</span><h2>LIVE ACTIVITY</h2><small>VERIFIABLE EVENTS</small></div>
      <div className="event-table"><div className="event-head"><span>TIME</span><span>EVENT</span><span>BLOCK</span><span>REFERENCE</span></div>
      {events.slice(0, 10).map((event) => { const identity = system.detectedTokens.find((item) => item.address.toLowerCase() === event.token?.address.toLowerCase()); return <div className={event.decisionId ? "event-line is-clickable" : "event-line"} key={event.id} onClick={() => { const match = receipts.find((item) => item.decisionId === event.decisionId); if (match) setReceipt(match); }}><time>{new Date(event.timestamp).toLocaleTimeString([], { hour12: false })}</time><span className="event-kind"><strong>{event.type.replaceAll("_", " ")}</strong>{event.token ? <TokenIdentityCompact token={event.token} {...(identity ? { identity, onOpen: setTokenDetail } : {})} /> : null}</span><span>{event.blockNumber?.toLocaleString() ?? "—"}</span>{event.txHash ? <a href={`${BSC_EXPLORER}/tx/${event.txHash}`} target="_blank" rel="noreferrer">{short(event.txHash)} <ExternalLink /></a> : <span>—</span>}</div>; })}</div>
    </section>
    <section className="data-section brain-section"><div className="section-title"><span>02</span><h2>SELF-AWARENESS</h2><small>REAL STATE ONLY</small></div><div className="system-grid awareness-grid">{awareness.map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div></section>
    <section className="data-section token-section"><div className="section-title"><span>05</span><h2>MY TOKEN</h2><small>{system.walletConfigured ? "MONITORING WALLET" : "CONFIG REQUIRED"}</small></div>{system.selfToken ? <div className="identity-state"><TokenIdentityCompact token={system.selfToken} identity={system.selfToken} onOpen={setTokenDetail} /><div><strong>A TOKEN WAS LAUNCHED FROM MY WALLET</strong><p>{system.selfToken.holders !== undefined ? `${system.selfToken.holders} verified holders` : "Holder index incomplete"} · separate from trading positions</p></div></div> : <div className="identity-state"><Wallet /><div><strong>{system.walletConfigured ? short(system.walletAddress ?? "") : "WAITING FOR IDENTITY TOKEN"}</strong><p>{system.walletConfigured ? `${system.walletBalanceBnb ?? "—"} BNB · watching verified launch events` : "Set NEXA_WALLET_ADDRESS to begin public wallet monitoring."}</p></div></div>}</section>
    <section className="data-section memory-section"><div className="section-title"><span>05</span><h2>MEMORY</h2><small>OPERATIONAL MEMORY · NOT RETRAINING</small></div>
      {outcomes.length ? outcomes.map((event) => <div className="empty-line" key={event.id}>{String(event.data["outcome"] ?? "OTHER")} · {String(event.data["reflection"] ?? "")}<span>{String(event.data["realizedPnlBnb"] ?? "—")} BNB</span></div>) : <div className="identity-state"><Terminal /><div><strong>NO OUTCOMES RECORDED</strong><p>Reflections are written only when a real position closes.</p></div></div>}
      <div className="empty-line">RISK ADAPTATIONS <span>{riskChanges.length ? riskChanges.map((event) => `${String(event.data["old"])}→${String(event.data["new"])}`).join(", ") : "NONE"}</span></div>
      <div className="empty-line">SOCIAL VOICE <span>{system.social.replaceAll("_", " ")}</span></div></section>
    <section className="data-section system-section"><div className="section-title"><span>06</span><h2>SYSTEM</h2><small>{system.status.replace("_", " ").toUpperCase()}</small></div><div className="system-grid">
      {[ ["PROVIDER", "BSC RPC"], ["CHAIN", "56 / BSC"], ["RPC", system.rpcStatus], ["LAST BLOCK", system.lastBlock?.toLocaleString() ?? "—"], ["LATENCY", system.latencyMs ? `${system.latencyMs} ms` : "—"], ["EVENT RATE", `${system.eventRate}/tick`], ["QUEUE", String(system.queueDepth)], ["EXECUTION", system.executionMode], ["SIGNER", system.signer.replaceAll("_", " ")], ["MAX TRADE", `${system.hardLimits.maxTradeSizeBnb} BNB`], ["MAX EXPOSURE", `${system.hardLimits.maxTotalExposureBnb} BNB`], ["DAILY LOSS", `${system.hardLimits.maxDailyLossBnb} BNB`], ["SLIPPAGE", `${system.hardLimits.maxSlippageBps} BPS`], ["EMERGENCY STOP", system.hardLimits.emergencyStop ? "ON" : "OFF"] ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <ReadinessChecklist /><div className="module-line">{Object.entries(system.modules).map(([name, state]) => <span key={name} className={state === "ready" ? "module-ready" : ""}>{name}<i /></span>)}</div>
    </section>
    <section className="data-section open-section"><div className="section-title"><span>07</span><h2>NEXA CORE</h2><small>OPEN-SOURCE READY</small></div><div className="architecture-line"><b>AGENT</b><i>→</i><b>BRAIN / MEMORY</b><i>→</i><b>POLICY</b><i>→</i><b>WALLET</b><i>→</i><b>BNB / FLAP</b></div><div className="open-body"><div><ShieldCheck /><p>Cloneable architecture with signing isolated behind policy and server boundaries.</p></div><pre><code>{`git clone <your-fork>\ncp .env.example .env  # placeholders only\nbun install\nbun run dev`}</code></pre></div><Button className="github-disabled" disabled>GITHUB · REPOSITORY PENDING</Button></section>
    <ReceiptDrawer receipt={receipt} onClose={() => setReceipt(null)} />
    <TokenDetailDrawer token={tokenDetail} onClose={() => setTokenDetail(null)} />
  </div>;
}
