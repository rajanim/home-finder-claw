import Link from "next/link";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EvalRunner } from "@/components/EvalRunner";
import { TraceTimeline } from "@/components/TraceTimeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Stats = {
  total_traces: number;
  total_spans: number;
  agents: Array<{
    agent: string;
    count: number;
    p50_ms: number;
    p95_ms: number;
    ok_rate: number;
  }>;
  recent_traces: Array<{
    trace_id: string;
    started_at: string;
    spans: number;
    ok_count: number;
    total_ms: number;
  }>;
};

async function loadEvalSet() {
  const file = path.join(process.cwd(), "tests", "eval-set.json");
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text) as Parameters<
    typeof EvalRunner
  >[0]["evalSet"];
}

async function loadStats(baseUrl: string): Promise<Stats | null> {
  try {
    const r = await fetch(`${baseUrl}/api/eval/stats`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Stats;
  } catch {
    return null;
  }
}

export default async function EvalPage() {
  const evalSet = await loadEvalSet();
  // Server-side fetch needs an absolute URL. Build from headers if available
  // (we are server-side in App Router, so use the host header workaround).
  const baseUrl =
    process.env.VERCEL_URL && !process.env.VERCEL_URL.startsWith("http")
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const stats = await loadStats(baseUrl);

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-border bg-background px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Search
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">Eval dashboard</span>
          <Badge variant="secondary" className="text-xs">
            Phase 6
          </Badge>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl space-y-6 p-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Eval and tracing
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            30 labeled queries across 5 categories (filter accuracy, semantic
            match, geo, Fair Housing guard, researcher quality). The runner
            executes them sequentially through the production agents and scores
            with deterministic rules. Stats below come from{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              traces-v1
            </code>{" "}
            in OpenSearch.
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Total traces"
            value={stats?.total_traces.toLocaleString() ?? "n/a"}
          />
          <StatCard
            label="Total spans"
            value={stats?.total_spans.toLocaleString() ?? "n/a"}
          />
          <StatCard
            label="Agents seen"
            value={String(stats?.agents.length ?? 0)}
          />
          <StatCard label="Eval cases" value={String(evalSet.cases.length)} />
        </div>

        {/* Per-agent latency table */}
        {stats && stats.agents.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 text-right font-medium">Spans</th>
                  <th className="px-3 py-2 text-right font-medium">p50 ms</th>
                  <th className="px-3 py-2 text-right font-medium">p95 ms</th>
                  <th className="px-3 py-2 text-right font-medium">OK rate</th>
                </tr>
              </thead>
              <tbody>
                {stats.agents.map((a) => (
                  <tr
                    key={a.agent}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-3 py-2 font-medium">{a.agent}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.p50_ms}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.p95_ms}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {(a.ok_rate * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Eval runner */}
        <EvalRunner evalSet={evalSet} />

        {/* Recent traces */}
        {stats && stats.recent_traces.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold tracking-tight">
              Recent traces
            </h3>
            <RecentTracesList traces={stats.recent_traces} />
          </div>
        )}
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function RecentTracesList({
  traces,
}: {
  traces: Stats["recent_traces"];
}) {
  return (
    <ul className="space-y-3">
      {traces.slice(0, 5).map((t) => (
        <li key={t.trace_id} className="rounded-lg border bg-background p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono">{t.trace_id.slice(0, 8)}</span>
              <span className="text-muted-foreground">
                {t.spans} span{t.spans === 1 ? "" : "s"}
              </span>
              <span className="text-muted-foreground">
                {t.total_ms.toLocaleString()} ms
              </span>
              <span
                className={
                  t.ok_count === t.spans
                    ? "text-emerald-600"
                    : "text-destructive"
                }
              >
                {t.ok_count}/{t.spans} ok
              </span>
            </div>
            <time className="text-muted-foreground">
              {new Date(t.started_at).toLocaleTimeString()}
            </time>
          </div>
          <TraceTimeline traceId={t.trace_id} />
        </li>
      ))}
    </ul>
  );
}
