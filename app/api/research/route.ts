// GET /api/research?listing_id=L<hex>
//
// Server-Sent Events stream. Each `data:` line is a JSON-encoded event of
// type ResearchEvent (see lib/types.ts).
//
// Phase order:
//   1. phase: planning  -> Llama 3.3 70B picks fetchers
//   2. planned          -> the chosen list
//   3. phase: fetching  -> deterministic OpenSearch reads in parallel
//   4. fetched          -> short summary of what came back per source
//   5. phase: synthesizing
//   6. delta            -> repeated, raw token text from Llama 3.1 405B
//   7. complete         -> with trace_id
//   on error: { type: "error", message }
//
// Browser usage:
//   const es = new EventSource('/api/research?listing_id=...');
//   es.onmessage = e => { const ev = JSON.parse(e.data); ... };

import {
  planFetchers,
  runFetchers,
  summarizeFetched,
  synthesizeBullets,
} from "@/lib/agents/researcher";
import { getOpenSearch, Indexes } from "@/lib/opensearch";
import { envPresence } from "@/lib/env";
import {
  endSpan,
  flushTrace,
  startSpan,
  startTrace,
} from "@/lib/tracing";
import type { Listing, ResearchEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sse(event: ResearchEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function GET(req: Request) {
  const presence = envPresence([
    "NVIDIA_API_KEY",
    "OPENSEARCH_URL",
    "OPENSEARCH_USERNAME",
    "OPENSEARCH_PASSWORD",
  ]);
  const missing = Object.entries(presence)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    return new Response(`Missing env: ${missing.join(", ")}`, { status: 503 });
  }

  const url = new URL(req.url);
  const listingId = url.searchParams.get("listing_id");
  if (!listingId) {
    return new Response("missing listing_id", { status: 400 });
  }

  // Fetch the listing first. If it does not exist we fail fast with a 404
  // before opening the SSE stream.
  let listing: Listing;
  try {
    const client = getOpenSearch();
    const r = await client.get({ index: Indexes.listings, id: listingId });
    const body = (r as unknown as { body?: { _source?: Listing } }).body;
    listing =
      body?._source ??
      ((r as unknown as { _source?: Listing })._source as Listing);
    if (!listing) throw new Error("no _source");
  } catch {
    return new Response(`listing not found: ${listingId}`, { status: 404 });
  }

  const traceId = startTrace();
  const root = startSpan({
    traceId,
    agent: "Supervisor",
    kind: "supervisor.research",
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ResearchEvent) => {
        try {
          controller.enqueue(sse(e));
        } catch {
          // controller may be closed if the client disconnected; ignore.
        }
      };

      try {
        send({ type: "phase", name: "planning" });
        const fetchers = await planFetchers(
          { zip: listing.zip, borough: listing.borough },
          { traceId, parentSpanId: root.spanId },
        );
        send({ type: "planned", fetchers });

        send({ type: "phase", name: "fetching" });
        const fetched = await runFetchers(
          fetchers,
          { zip: listing.zip, listing },
          { traceId, parentSpanId: root.spanId },
        );
        send({ type: "fetched", summary: summarizeFetched(fetched) });

        send({ type: "phase", name: "synthesizing" });
        for await (const delta of synthesizeBullets(fetched, {
          traceId,
          parentSpanId: root.spanId,
        })) {
          send({ type: "delta", text: delta });
        }

        send({ type: "complete", trace_id: traceId });
        endSpan(root, {
          input: { listing_id: listingId, zip: listing.zip },
          output: { fetchers, complete: true },
          ok: true,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        send({ type: "error", message });
        endSpan(root, {
          input: { listing_id: listingId },
          ok: false,
          error: message,
        });
      } finally {
        // Spans flush in the background; do not await before closing the
        // stream so the client sees "complete" promptly.
        flushTrace(traceId).catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Vercel + nginx-style buffering disable.
      "X-Accel-Buffering": "no",
    },
  });
}
