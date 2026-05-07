// POST /api/research/quick
//
// Body: { listing_id: string }
// Returns the deterministic fetcher output for a listing's ZIP, without
// running the synthesizer. Used by the voice agent so the model can
// describe a neighborhood in its own voice without waiting ~5 seconds for
// streamed bullets.
//
// Pipeline: planner (Llama 3.3 70B picks fetchers) -> 4 OpenSearch fetchers
// in parallel. Total latency ~1.5-2 seconds.

import { NextResponse } from "next/server";
import {
  planFetchers,
  runFetchers,
  summarizeFetched,
} from "@/lib/agents/researcher";
import { getOpenSearch, Indexes } from "@/lib/opensearch";
import { envPresence } from "@/lib/env";
import {
  endSpan,
  flushTrace,
  startSpan,
  startTrace,
} from "@/lib/tracing";
import type { Listing } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
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
    return NextResponse.json(
      { error: `Missing env: ${missing.join(", ")}` },
      { status: 503 },
    );
  }

  let payload: { listing_id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const listingId =
    typeof payload.listing_id === "string" ? payload.listing_id : "";
  if (!listingId) {
    return NextResponse.json(
      { error: "Missing or invalid 'listing_id' field" },
      { status: 400 },
    );
  }

  const traceId = startTrace();
  const root = startSpan({
    traceId,
    agent: "Supervisor",
    kind: "supervisor.research_quick",
  });

  try {
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
      endSpan(root, { ok: false, error: "listing not found" });
      flushTrace(traceId).catch(() => {});
      return NextResponse.json(
        { error: `listing not found: ${listingId}` },
        { status: 404 },
      );
    }

    const fetchers = await planFetchers(
      { zip: listing.zip, borough: listing.borough },
      { traceId, parentSpanId: root.spanId },
    );
    const fetched = await runFetchers(
      fetchers,
      { zip: listing.zip, listing },
      { traceId, parentSpanId: root.spanId },
    );

    endSpan(root, {
      input: { listing_id: listingId },
      output: { fetchers, sources: Object.keys(fetched).length },
      ok: true,
    });
    flushTrace(traceId).catch(() => {});

    return NextResponse.json({
      trace_id: traceId,
      listing: {
        listing_id: listing.listing_id,
        price: listing.price,
        beds: listing.beds,
        baths: listing.baths,
        borough: listing.borough,
        zip: listing.zip,
        nearest_subway: listing.nearest_subway,
        subway_distance_m: listing.subway_distance_m,
      },
      fetchers,
      data: fetched,
      summary: summarizeFetched(fetched),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endSpan(root, { ok: false, error: message });
    flushTrace(traceId).catch(() => {});
    return NextResponse.json(
      { error: `quick research failed: ${message}` },
      { status: 500 },
    );
  }
}
