import type { NexaEvent } from "../types";

export interface SocialDraft { eventId: string; text: string; kind: "ENTRY" | "EXIT" | "MILESTONE" | "SELF_TOKEN" | "RISK" | "SYSTEM"; }
export interface SocialPublisher { readonly state: "SOCIAL_PUBLISHING_DISABLED" | "ENABLED"; publish(draft: SocialDraft): Promise<{ id: string } | null>; }

const KIND: Partial<Record<NexaEvent["type"], SocialDraft["kind"]>> = {
  TRADE_EXECUTED: "ENTRY", POSITION_CLOSED: "EXIT", SELF_TOKEN_DETECTED: "SELF_TOKEN", NEW_HOLDER: "SELF_TOKEN",
  RISK_POLICY_UPDATED: "RISK", EXECUTION_PAUSED: "SYSTEM", OUTCOME_RECORDED: "MILESTONE",
};

/** Builds a draft only from HIGH/CRITICAL structured events; scans and snapshots never produce drafts. */
export function draftFromEvent(event: NexaEvent): SocialDraft | null {
  const kind = KIND[event.type];
  if (!kind || (event.priority !== "high" && event.priority !== "critical")) return null;
  const symbol = event.token?.symbol ? `$${event.token.symbol}` : event.token?.address.slice(0, 10) ?? "";
  const message = String(event.data["message"] ?? event.type.replaceAll("_", " "));
  const proof = event.txHash ? ` bscscan.com/tx/${event.txHash}` : "";
  return { eventId: event.id, kind, text: `${message}${symbol ? ` ${symbol}` : ""}${proof}`.slice(0, 270) };
}

/** Default publisher. Never posts. Credentials, if ever added, live in server secrets only. */
export const disabledPublisher: SocialPublisher = { state: "SOCIAL_PUBLISHING_DISABLED", async publish() { return null; } };
