import { useSyncExternalStore } from "react";
import { DEFAULT_HARD_LIMITS, EMPTY_COUNTERS } from "./agent/rules";
import type { NexaEvent, ProviderStatus, StreamPacket, SystemSnapshot } from "./types";
const MAX_EVENTS = 80;
const listeners = new Set<() => void>();
const initialSystem: SystemSnapshot = {
  status: "connecting", chainId: 56, chainName: "BNB Smart Chain", rpcStatus: "offline", eventRate: 0, queueDepth: 0,
  flapPortal: "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0", flapConfigured: true, walletConfigured: false,
  executionMode: "NO_SIGNER", requestedExecutionMode: "NO_SIGNER", modules: { SCOUT: "waiting", ANALYST: "waiting", BRAIN: "waiting", TRADER: "waiting", MEMORY: "ready", WALLET: "waiting", FLAP: "ready" },
  protection: { state: "PROTECTING_CAPITAL", executionPaused: true, reasons: ["SIGNER_UNAVAILABLE"] }, hardLimits: DEFAULT_HARD_LIMITS, riskMultiplier: 1,
  counters: EMPTY_COUNTERS, signer: "NOT_CONFIGURED", social: "SOCIAL_PUBLISHING_DISABLED", readiness: [],
  integrations: Object.fromEntries((["RPC", "INDEXER", "FLAP", "PRICING", "HOLDERS", "WALLET", "SIGNER", "EXECUTION"] as const).map((name) => [name, { state: "offline", detail: "CONNECTING" }])) as SystemSnapshot["integrations"],
  detectedTokens: [], openPositions: [], closedPositions: [], dryRunIntents: [],
};
let system = initialSystem;
let events: NexaEvent[] = [];
let version = 0;
function emit() { version += 1; listeners.forEach((listener) => listener()); }
export const nexaStore = {
  subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  ingest(packet: StreamPacket) { system = packet.snapshot; events = [...packet.events, ...events].slice(0, MAX_EVENTS); emit(); },
  setStatus(status: ProviderStatus) { if (system.status !== status) { system = { ...system, status }; emit(); } },
  getSystem: () => system, getEvents: () => events, getVersion: () => version,
};
export function useNexaSystem() { return useSyncExternalStore(nexaStore.subscribe, nexaStore.getSystem, nexaStore.getSystem); }
export function useNexaEvents() { useSyncExternalStore(nexaStore.subscribe, nexaStore.getVersion, nexaStore.getVersion); return nexaStore.getEvents(); }
