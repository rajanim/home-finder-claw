"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type Span = {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  agent: string;
  kind: string;
  started_at: string;
  ended_at: string;
  latency_ms: number;
  model?: string;
  ok: boolean;
  error?: string;
  tokens_in?: number;
  tokens_out?: number;
};

type Props = {
  traceId: string;
};

const COLOR_BY_AGENT: Record<string, string> = {
  Supervisor: "bg-slate-400",
  FairHousingGuard: "bg-amber-500",
  IntentDecomposer: "bg-violet-500",
  HybridRetriever: "bg-sky-500",
  "NeighborhoodResearcher.Planner": "bg-emerald-500",
  "NeighborhoodResearcher.Fetchers": "bg-emerald-400",
  "NeighborhoodResearcher.Synthesizer": "bg-emerald-600",
  Comparator: "bg-rose-500",
  "Comparator.Loader": "bg-rose-400",
};

function colorFor(agent: string): string {
  return COLOR_BY_AGENT[agent] ?? "bg-primary";
}

export function TraceTimeline({ traceId }: Props) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; spans: Span[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    fetch(`/api/trace/${encodeURIComponent(traceId)}`)
      .then(async (resp) => {
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setState({ kind: "error", message: err.error ?? `HTTP ${resp.status}` });
          return;
        }
        const data = (await resp.json()) as { spans: Span[] };
        setState({ kind: "ready", spans: data.spans });
      })
      .catch((e) => setState({ kind: "error", message: String(e) }));
  }, [traceId]);

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading trace {traceId.slice(0, 8)}...
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
        {state.message}
      </div>
    );
  }
  const spans = state.spans;
  if (spans.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        No spans for this trace.
      </div>
    );
  }
  // Compute the trace timeline window.
  const startMs = Math.min(
    ...spans.map((s) => new Date(s.started_at).getTime()),
  );
  const endMs = Math.max(...spans.map((s) => new Date(s.ended_at).getTime()));
  const totalMs = Math.max(1, endMs - startMs);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3 border-b pb-2 text-xs">
        <span className="font-mono text-muted-foreground">
          {traceId.slice(0, 8)}
        </span>
        <span className="text-muted-foreground">
          {spans.length} span{spans.length === 1 ? "" : "s"}
        </span>
        <span className="text-muted-foreground">
          {totalMs.toLocaleString()} ms total
        </span>
      </div>
      <ol className="space-y-1.5">
        {spans.map((s) => {
          const offset = new Date(s.started_at).getTime() - startMs;
          const offsetPct = (offset / totalMs) * 100;
          const widthPct = Math.max(
            0.5,
            (s.latency_ms / totalMs) * 100,
          );
          return (
            <li
              key={s.span_id}
              className="grid grid-cols-[minmax(180px,220px)_1fr_auto] items-center gap-3 text-xs"
            >
              <div className="min-w-0 truncate">
                <span className="font-medium">{s.agent}</span>
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {s.kind}
                </span>
              </div>
              <div className="relative h-5 rounded bg-muted/40">
                <div
                  className={`absolute top-0 h-full rounded ${colorFor(s.agent)} ${s.ok ? "" : "ring-2 ring-destructive"}`}
                  style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                  title={`${s.agent} ${s.kind}: ${s.latency_ms} ms`}
                />
              </div>
              <div className="text-right tabular-nums text-muted-foreground">
                {s.latency_ms} ms
                {s.tokens_in !== undefined && (
                  <span className="ml-1 text-[10px]">
                    {(s.tokens_in ?? 0) + (s.tokens_out ?? 0)} tok
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
