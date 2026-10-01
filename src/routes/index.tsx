import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AtSign, Radio, Wallet } from "lucide-react";
import { NexaCore } from "@/components/nexa/NexaCore";
import { ThoughtStream } from "@/components/nexa/ThoughtStream";
import { useLiveProvider } from "@/nexa/use-live-provider";
import { useNexaEvents, useNexaSystem } from "@/nexa/store";
import { derivePhase } from "@/nexa/derive";
import { AutonomyCounters, IntegrationBar, LatestReceipt, LiveStrategy, ProtectionBanner, ReplayPanel } from "@/components/nexa/AutonomyPanels";
import ParticleDrift from "@/components/ui/particle-drift";
const DashboardSections = lazy(() => import("@/components/nexa/DashboardSections").then((module) => ({ default: module.DashboardSections })));
export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "NEXA — Autonomous Onchain Agent" },
    { name: "description", content: "NEXA observes verified Flap activity on BNB Smart Chain and turns onchain evidence into traceable agent decisions." },
    { property: "og:title", content: "NEXA — Autonomous Onchain Agent" },
    { property: "og:description", content: "A living onchain agent foundation for Flap on BNB Smart Chain, powered by verifiable events." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }), component: Index,
});
function Index() {
  useLiveProvider(); const system = useNexaSystem(); const events = useNexaEvents();
  const live = system.status === "live";
  const phase = derivePhase(events);
  return <main className="nexa-app">
    <ParticleDrift className="page-particle-drift" />
    <header className="nexa-header"><div className="brand"><span className="brand-mark">◉</span><strong>NEXA</strong><span>AUTONOMOUS ONCHAIN AGENT</span></div><nav>
      <span className={`mode-badge mode-${system.status}`}><i />{live ? "LIVE ONCHAIN" : system.status.replace("_", " ").toUpperCase()}</span>
      <a className="header-item header-link wallet-link" href="https://bscscan.com/address/0x4ebc9d7bc99d8e8e16fc30802b3b90a5d410ee30" target="_blank" rel="noreferrer" aria-label="View NEXA public wallet on BscScan"><Wallet /><span className="desktop-address">0x4ebc…ee30</span><span className="mobile-address">WALLET</span></a>
      <a className="header-item header-link" href="https://x.com/nexa_agentbsc" target="_blank" rel="noreferrer" aria-label="Open NEXA on X"><AtSign />NEXA_AGENTBSC</a>
    </nav></header>
    <section className="hero-shell">
      <div className="hero-meta"><div><span className="eyebrow">AUTONOMOUS ONCHAIN INTELLIGENCE</span><h1>NEXA</h1><p>Observing Flap on BNB Smart Chain. Every visible signal is tied to verifiable chain data.</p><ProtectionBanner /><IntegrationBar /></div><div className="hero-status"><Radio /><span>PROVIDER</span><strong>{live ? "SYNCHRONIZED" : system.status.replace("_", " ").toUpperCase()} · #{system.lastBlock?.toLocaleString() ?? "—"}</strong></div></div>
      <div className="hero-grid"><div className="visual-column"><NexaCore active={live} tokens={system.detectedTokens.slice(0, 8)} owned={system.openPositions.map((position) => position.token)} /><AutonomyCounters /></div><div className="side-column"><LiveStrategy /><ThoughtStream /><div className="side-actions"><ReplayPanel /><LatestReceipt /></div></div></div>
      <div className="state-rail"><div>{["SCOUT", "BRAIN", "TRADER", "MEMORY", "WALLET", "FLAP"].map((item) => <span key={item} className={system.modules[item as keyof typeof system.modules] === "ready" ? "rail-ready" : ""}>{item}<i /></span>)}</div><ol>{(["OBSERVE", "THINK", "ACT", "LEARN"] as const).map((step) => <li key={step} className={step === phase ? "is-active" : ""}>{step}</li>)}</ol></div>
    </section>
    <Suspense fallback={<div className="section-skeleton">LOADING SYSTEM SURFACES</div>}><DashboardSections /></Suspense>
    <footer><span>◉ NEXA</span><span>BNB SMART CHAIN · CHAIN ID 56</span><span>NO SIGNER · EXECUTION DISABLED</span></footer>
  </main>;
}
