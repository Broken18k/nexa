import { createFileRoute } from "@tanstack/react-router";

const GATEWAYS = ["https://flap.mypinata.cloud/ipfs/", "https://gateway.pinata.cloud/ipfs/"] as const;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const validCid = (value: string | null) => Boolean(value && /^[a-zA-Z0-9]+$/.test(value) && value.length <= 120);

export const Route = createFileRoute("/api/public/nexa-token-image")({
  server: { handlers: { GET: async ({ request }) => {
    const cid = new URL(request.url).searchParams.get("cid");
    if (!validCid(cid) || !cid) return new Response("Invalid CID", { status: 400 });
    for (const gateway of GATEWAYS) {
      const upstream = await fetch(`${gateway}${cid}`, { signal: AbortSignal.timeout(gateway.includes("gateway.pinata.cloud") ? 12_000 : 5_000), headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } }).catch(() => null);
      if (!upstream?.ok || !upstream.body) continue;
      const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      const contentLength = Number(upstream.headers.get("content-length") ?? 0);
      if (!ALLOWED.has(contentType) || contentLength > MAX_IMAGE_BYTES) continue;
      const bytes = await upstream.arrayBuffer();
      if (bytes.byteLength > MAX_IMAGE_BYTES) continue;
      return new Response(bytes, { headers: { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
    }
    return new Response("Image unavailable", { status: 404, headers: { "cache-control": "no-store" } });
  } } },
});