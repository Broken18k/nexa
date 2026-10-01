import type { NexaProvider } from "./provider";
import type { StreamPacket } from "../types";
export class LiveProvider implements NexaProvider {
  readonly name = "BSC mainnet";
  connect(onPacket: (packet: StreamPacket) => void, onError: () => void) {
    const stream = new EventSource("/api/public/nexa-stream");
    stream.addEventListener("packet", (message) => {
      try { onPacket(JSON.parse((message as MessageEvent<string>).data) as StreamPacket); } catch { onError(); }
    });
    stream.onerror = onError;
    return () => stream.close();
  }
}
