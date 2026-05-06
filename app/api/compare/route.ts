// POST /api/compare
//
// Body:    { listing_ids: string[] }   // 2 to 4 ids
// Returns: { trace_id, listings[], result: { rows[], tradeoffs }, agent_activity[] }
//
// Example:
//   curl -s -X POST https://home-finder-claw.vercel.app/api/compare \
//     -H 'Content-Type: application/json' \
//     -d '{"listing_ids":["lst_abc","lst_def"]}' | jq .

import { NextResponse } from "next/server";
import { runCompare } from "@/lib/agents/supervisor";
import { envPresence } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  let payload: { listing_ids?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = Array.isArray(payload.listing_ids)
    ? payload.listing_ids.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length < 2 || ids.length > 4) {
    return NextResponse.json(
      { error: "listing_ids must be an array of 2 to 4 strings" },
      { status: 400 },
    );
  }

  try {
    const result = await runCompare(ids);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Compare failed: ${message}` },
      { status: 500 },
    );
  }
}
