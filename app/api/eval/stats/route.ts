// GET /api/eval/stats
//
// Aggregates from traces-v1: per-agent count, p50/p95 latency_ms, total
// trace count, recent traces (last 20). Read-only OpenSearch queries.

import { NextResponse } from "next/server";
import { getOpenSearch, Indexes } from "@/lib/opensearch";
import { envPresence } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
    const aggResp = await client.search({
      index: Indexes.traces,
      body: {
        size: 0,
        aggs: {
          by_agent: {
            terms: { field: "agent", size: 20 },
            aggs: {
              latency: {
                percentiles: { field: "latency_ms", percents: [50, 95] },
              },
              ok_rate: { avg: { script: "doc['ok'].value ? 1 : 0" } },
            },
          },
          total_traces: {
            cardinality: { field: "trace_id", precision_threshold: 1000 },
          },
        },
      },
    });
    const recent = await client.search({
      index: Indexes.traces,
      body: {
        size: 1000,
        sort: [{ started_at: "desc" }],
        // We pull spans then group on the client side; trace count is small in
        // a Sandbox tier so this is fine.
        _source: [
          "trace_id",
          "agent",
          "kind",
          "started_at",
          "latency_ms",
          "ok",
        ],
      },
    });
    const aggBody = (aggResp as unknown as { body?: unknown }).body ?? aggResp;
    const recentBody = (recent as unknown as { body?: unknown }).body ?? recent;
    const aggregations =
      (aggBody as Record<string, Record<string, unknown>>).aggregations ?? {};
    const byAgent = (aggregations.by_agent as { buckets?: unknown[] })?.buckets ?? [];
    type AgentBucket = {
      key: string;
      doc_count: number;
      latency: { values: Record<string, number> };
      ok_rate: { value: number };
    };
    const agents = (byAgent as AgentBucket[]).map((b) => ({
      agent: b.key,
      count: b.doc_count,
      p50_ms: Math.round(b.latency.values["50.0"] ?? 0),
      p95_ms: Math.round(b.latency.values["95.0"] ?? 0),
      ok_rate: b.ok_rate.value,
    }));
    const totalTraces =
      ((aggregations.total_traces as { value?: number })?.value as number) ?? 0;
    const recentHits =
      ((recentBody as Record<string, Record<string, unknown>>).hits?.hits as
        | Array<{ _source: Record<string, unknown> }>
        | undefined) ?? [];
    // Group spans per trace_id, keep most recent N traces.
    const tracesMap = new Map<
      string,
      { trace_id: string; started_at: string; spans: number; ok_count: number; total_ms: number }
    >();
    for (const h of recentHits) {
      const s = h._source;
      const tid = s.trace_id as string;
      if (!tid) continue;
      const t =
        tracesMap.get(tid) ??
        {
          trace_id: tid,
          started_at: s.started_at as string,
          spans: 0,
          ok_count: 0,
          total_ms: 0,
        };
      t.spans += 1;
      if (s.ok) t.ok_count += 1;
      t.total_ms += (s.latency_ms as number) ?? 0;
      if ((s.started_at as string) < t.started_at) t.started_at = s.started_at as string;
      tracesMap.set(tid, t);
    }
    const traces = [...tracesMap.values()]
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 20);
    return NextResponse.json({
      total_traces: totalTraces,
      total_spans: (recentHits as Array<{ _source: Record<string, unknown> }>).length,
      agents,
      recent_traces: traces,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `stats failed: ${message}` },
      { status: 500 },
    );
  }
}
