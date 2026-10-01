import { createFileRoute } from "@tanstack/react-router";
import { readLivePacket } from "@/nexa/providers/indexer.server";
export const Route = createFileRoute("/api/public/nexa-stream")({
  server: { handlers: { GET: async ({ request }) => {
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, value: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
        const close = () => { if (!closed) { closed = true; try { controller.close(); } catch { /* already closed */ } } };
        request.signal.addEventListener("abort", close, { once: true });
        for (let tick = 0; tick < 120 && !closed; tick += 1) {
          try { send("packet", await readLivePacket()); }
          catch (error) { send("status", { status: "offline", message: error instanceof Error ? error.message : "RPC unavailable" }); }
          await new Promise((resolve) => setTimeout(resolve, 3_500));
        }
        close();
      }, cancel() { closed = true; },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
  } } },
});
