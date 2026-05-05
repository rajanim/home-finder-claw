// GET /api/health
//
// Returns env presence (booleans only, never the values themselves) so the
// deployer can quickly tell whether Vercel has the required secrets wired up.
//
// Example:
//   curl -s https://home-finder-claw.vercel.app/api/health | jq .

import { NextResponse } from "next/server";
import { envPresence } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const presence = envPresence([
    "OPENAI_API_KEY",
    "OPENSEARCH_URL",
    "OPENSEARCH_USERNAME",
    "OPENSEARCH_PASSWORD",
    "NEXT_PUBLIC_MAPBOX_TOKEN",
  ]);
  return NextResponse.json({
    ok: true,
    phase: 0,
    env: presence,
  });
}
