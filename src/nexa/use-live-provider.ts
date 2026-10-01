import { useEffect } from "react";
import { LiveProvider } from "./providers/live-provider";
import { nexaStore } from "./store";
export function useLiveProvider() {
  useEffect(() => {
    const provider = new LiveProvider();
    return provider.connect((packet) => nexaStore.ingest(packet), () => nexaStore.setStatus("degraded"));
  }, []);
}
