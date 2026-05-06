// POST /api/search
//
// Body:    { query: string }
// Returns: { trace_id, intent, guard_pre, guard_post, listings[], aggregations }
//
// Example:
//   curl -s -X POST https://home-finder-claw.vercel.app/api/search \
//     -H 'Content-Type: application/json' \
//     -d '{"query":"two bed near F train under 1.2M"}' | jq .

import { NextResponse } from "next/server";
import { runSearch } from "@/lib/agents/supervisor";
import { envPresence } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // researcher synth in Phase 3 may approach 30s

export async function POST(req: Request) {
  // Fail fast on missing env so the UI gets a clear error instead of a 500.
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

  let payload: { query?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const query =
    typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query) {
    return NextResponse.json(
      { error: "Missing or empty 'query' field" },
      { status: 400 },
    );
  }
  if (query.length > 500) {
    return NextResponse.json(
      { error: "Query too long (max 500 chars)" },
      { status: 400 },
    );
  }

  try {
    const result = await runSearch(query);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Search failed: ${message}` },
      { status: 500 },
    );
  }
}
