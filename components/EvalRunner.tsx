"use client";

import { useCallback, useMemo, useState } from "react";
import { Play, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  parseBulletsFromText,
  scoreFilter,
  scoreGeo,
  scoreGuard,
  scoreResearcher,
  scoreSemantic,
  type ScoreOutcome,
} from "@/lib/eval/scoring";
import type { SearchResponse } from "@/lib/types";

type Case = {
  id: string;
  category: "filter" | "semantic" | "geo" | "guard" | "researcher";
  query?: string;
  warmup_query?: string;
  warmup_index?: number;
  expected: Record<string, unknown>;
};

type EvalSet = {
  version: number;
  description: string;
  cases: Case[];
};

type Result = {
  id: string;
  category: Case["category"];
  query: string;
  pass: boolean;
  reason: string;
  trace_id?: string;
  duration_ms: number;
};

type Props = {
  evalSet: EvalSet;
};

async function runResearcher(
  listingId: string,
): Promise<{ bullets: string[]; trace_id?: string }> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(
      `/api/research?listing_id=${encodeURIComponent(listingId)}`,
    );
    let text = "";
    let trace_id: string | undefined;
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "delta") text += ev.text;
        if (ev.type === "complete") {
          trace_id = ev.trace_id;
          es.close();
          resolve({ bullets: parseBulletsFromText(text), trace_id });
        }
        if (ev.type === "error") {
          es.close();
          reject(new Error(ev.message));
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      es.close();
      if (text) resolve({ bullets: parseBulletsFromText(text), trace_id });
      else reject(new Error("SSE connection error"));
    };
  });
}

export function EvalRunner({ evalSet }: Props) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [progressIdx, setProgressIdx] = useState(0);

  const total = evalSet.cases.length;
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.filter((r) => !r.pass).length;
  const passRate = results.length > 0 ? (passCount / results.length) * 100 : 0;

  const byCategory = useMemo(() => {
    const m: Record<string, { pass: number; total: number }> = {};
    for (const r of results) {
      m[r.category] ??= { pass: 0, total: 0 };
      m[r.category].total += 1;
      if (r.pass) m[r.category].pass += 1;
    }
    return m;
  }, [results]);

  const runOne = useCallback(
    async (c: Case): Promise<Result> => {
      const t0 = Date.now();
      try {
        if (c.category === "researcher") {
          // Need a listing_id. Fetch via warmup_query, take warmup_index'th.
          const search = await fetch("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: c.warmup_query }),
          });
          const data = (await search.json()) as SearchResponse;
          const idx = c.warmup_index ?? 0;
          const lid = data.listings?.[idx]?.listing_id;
          if (!lid) {
            return {
              id: c.id,
              category: c.category,
              query: c.warmup_query ?? "",
              pass: false,
              reason: `No listing at index ${idx} for warmup query.`,
              duration_ms: Date.now() - t0,
            };
          }
          const { bullets, trace_id } = await runResearcher(lid);
          const out: ScoreOutcome = scoreResearcher(c.expected as Parameters<typeof scoreResearcher>[0], { bullets });
          return {
            id: c.id,
            category: c.category,
            query: `research(${lid})`,
            pass: out.pass,
            reason: out.reason,
            trace_id,
            duration_ms: Date.now() - t0,
          };
        }
        const search = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: c.query }),
        });
        const data = (await search.json()) as SearchResponse;
        let outcome: ScoreOutcome;
        switch (c.category) {
          case "filter":
            outcome = scoreFilter(c.expected as Parameters<typeof scoreFilter>[0], data);
            break;
          case "semantic":
            outcome = scoreSemantic(c.expected as Parameters<typeof scoreSemantic>[0], data);
            break;
          case "geo":
            outcome = scoreGeo(c.expected as Parameters<typeof scoreGeo>[0], data);
            break;
          case "guard":
            outcome = scoreGuard(c.expected as Parameters<typeof scoreGuard>[0], data);
            break;
          default:
            outcome = { pass: false, reason: `Unknown category ${c.category}` };
        }
        return {
          id: c.id,
          category: c.category,
          query: c.query ?? "",
          pass: outcome.pass,
          reason: outcome.reason,
          trace_id: data.trace_id,
          duration_ms: Date.now() - t0,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          id: c.id,
          category: c.category,
          query: c.query ?? c.warmup_query ?? "",
          pass: false,
          reason: `Error: ${message}`,
          duration_ms: Date.now() - t0,
        };
      }
    },
    [],
  );

  const runAll = useCallback(async () => {
    setRunning(true);
    setResults([]);
    setProgressIdx(0);
    const out: Result[] = [];
    for (let i = 0; i < evalSet.cases.length; i++) {
      setProgressIdx(i);
      const r = await runOne(evalSet.cases[i]);
      out.push(r);
      setResults([...out]);
    }
    setProgressIdx(evalSet.cases.length);
    setRunning(false);
  }, [evalSet, runOne]);

  return (
    <div className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <button
          type="button"
          onClick={runAll}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {running ? `Running ${progressIdx + 1}/${total}...` : `Run eval set (${total} cases)`}
        </button>
        {results.length > 0 && (
          <>
            <div className="text-sm">
              <span className="font-semibold">
                {passRate.toFixed(0)}%
              </span>{" "}
              pass rate
              <span className="ml-2 text-muted-foreground">
                ({passCount} / {results.length})
              </span>
            </div>
            <div className="flex gap-2 text-xs">
              {Object.entries(byCategory).map(([k, v]) => (
                <span
                  key={k}
                  className="rounded bg-muted px-2 py-0.5 text-muted-foreground"
                >
                  {k}: {v.pass}/{v.total}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      {results.length > 0 && (
        <ol className="divide-y divide-border">
          {results.map((r) => (
            <li
              key={r.id}
              className="grid grid-cols-[1.25rem_minmax(0,16ch)_minmax(0,1fr)_auto] items-start gap-3 p-3 text-xs"
            >
              {r.pass ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
              )}
              <div className="min-w-0">
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {r.id}
                </div>
                <div className="truncate text-muted-foreground">{r.query}</div>
              </div>
              <div className="min-w-0">
                <div
                  className={
                    r.pass
                      ? "text-foreground"
                      : "text-destructive"
                  }
                >
                  {r.reason}
                </div>
                {r.trace_id && (
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    trace {r.trace_id.slice(0, 8)}
                  </div>
                )}
              </div>
              <div className="tabular-nums text-muted-foreground">
                {r.duration_ms} ms
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
