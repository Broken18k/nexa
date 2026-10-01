import type { NexaEvent } from "./types";

export const SIGNAL_FAMILIES = ["MOMENTUM", "WALLET_FLOW", "HOLDER_GROWTH", "VOLUME_ACCELERATION", "LIQUIDITY_QUALITY", "CONCENTRATION_RISK"] as const;
export type SignalFamily = (typeof SIGNAL_FAMILIES)[number];
export interface SignalState { family: SignalFamily; active: boolean; value?: number; reason?: string; eventId?: string; }

/** Signals are active only when a real TOKEN_ANALYSIS_UPDATED / DECISION_CREATED event carries them in data.signals. */
export function deriveStrategy(events: NexaEvent[]) {
  const analyses = events.filter((event) => event.type === "TOKEN_ANALYSIS_UPDATED" || event.type === "DECISION_CREATED");
  const latest = analyses[0];
  const raw = (latest?.data["signals"] ?? {}) as Partial<Record<SignalFamily, { value?: number; reason?: string }>>;
  const signals: SignalState[] = SIGNAL_FAMILIES.map((family) => {
    const hit = raw[family];
    return hit && latest ? { family, active: true, ...(hit.value !== undefined ? { value: hit.value } : {}), ...(hit.reason ? { reason: hit.reason } : {}), eventId: latest.id } : { family, active: false };
  });
  const priorityChanges = events.filter((event) => event.type === "RISK_POLICY_UPDATED" || (event.type === "DECISION_CREATED" && event.data["priority"])).slice(0, 3);
  return { latest, signals, priority: latest ? String(latest.data["priority"] ?? "UNSET") : undefined, reasonCodes: (latest?.data["reasonCodes"] as string[] | undefined) ?? [], priorityChanges };
}

export type Phase = "OBSERVE" | "THINK" | "ACT" | "LEARN";
export function derivePhase(events: NexaEvent[]): Phase {
  const type = events.find((event) => event.priority !== "low")?.type;
  if (!type) return "OBSERVE";
  if (type.startsWith("TRADE_") || type.startsWith("TX_") || type.startsWith("POSITION_")) return "ACT";
  if (type === "OUTCOME_RECORDED" || type === "MEMORY_UPDATED" || type === "RISK_POLICY_UPDATED") return "LEARN";
  if (type.startsWith("TOKEN_ANALYSIS") || type === "DECISION_CREATED" || type.startsWith("WATCHLIST")) return "THINK";
  return "OBSERVE";
}

export const RECEIPT_STAGES = ["DECISION_CREATED", "TOKEN_SNAPSHOT", "TRADE_INTENT_CREATED", "TRADE_BLOCKED", "TRADE_EXECUTION_STARTED", "TRADE_EXECUTED", "TX_CONFIRMED", "TX_FAILED", "POSITION_OPENED", "POSITION_UPDATED", "POSITION_CLOSED", "OUTCOME_RECORDED"] as const;
export interface DecisionReceipt { decisionId: string; events: NexaEvent[]; token?: NexaEvent["token"]; }
/** Groups events sharing a real decisionId into an ordered lifecycle. */
export function deriveReceipts(events: NexaEvent[]): DecisionReceipt[] {
  const map = new Map<string, NexaEvent[]>();
  for (const event of events) if (event.decisionId) map.set(event.decisionId, [...(map.get(event.decisionId) ?? []), event]);
  return [...map.entries()].map(([decisionId, list]) => {
    const ordered = [...list].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return { decisionId, events: ordered, token: ordered.find((event) => event.token)?.token };
  });
}

/** Stored real events from the last windowMs; never generates new ones. Low-priority block heartbeats are aggregated. */
export function replayFrames(events: NexaEvent[], now = Date.now(), windowMs = 60_000) {
  const recent = events.filter((event) => now - Date.parse(event.timestamp) <= windowMs).reverse();
  const meaningful = recent.filter((event) => event.priority !== "low");
  const blocks = recent.filter((event) => event.priority === "low").length;
  return { frames: meaningful.slice(-24), blocks, total: recent.length };
}
