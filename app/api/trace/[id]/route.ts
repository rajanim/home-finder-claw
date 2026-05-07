// GET /api/trace/:id
//
// Returns all spans for a single trace_id, sorted by started_at.

import { NextResponse } from "next/server";
import { getOpenSearch, Indexes } from "@/lib/opensearch";
import { envPresence } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const presence = envPresence([
    "OPENSEARCH_URL",
    "OPENSEARCH_USERNAME",
    "OPENSEARCH_PASSWORD",
  ]);
  if (Object.values(presence).some((v) => !v)) {
    return NextResponse.json(
      { error: "OpenSearch env vars missing" },
      { status: 503 },
    );
  }
  try {
    const client = getOpenSearch();
    const resp = await client.search({
      index: Indexes.traces,
      body: {
        size: 200,
        query: { term: { trace_id: id } },
        sort: [{ started_at: "asc" }],
      },
    });
    const body = (resp as unknown as { body?: unknown }).body ?? resp;
    const hits =
      ((body as Record<string, Record<string, unknown>>).hits?.hits as
        | Array<{ _source: Record<string, unknown> }>
        | undefined) ?? [];
    const spans = hits.map((h) => h._source);
    if (spans.length === 0) {
      return NextResponse.json({ error: "Trace not found" }, { status: 404 });
    }
    return NextResponse.json({ trace_id: id, spans });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `trace fetch failed: ${message}` },
      { status: 500 },
    );
  }
}
