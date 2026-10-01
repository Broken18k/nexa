import type { StreamPacket } from "../types";
export interface NexaProvider {
  readonly name: string;
  connect(onPacket: (packet: StreamPacket) => void, onError: () => void): () => void;
}
