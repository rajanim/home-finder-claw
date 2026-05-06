"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { ResearchEvent, ResearchPhase } from "@/lib/types";

type Props = {
  listingId: string;
};

export function ResearchPanel({ listingId }: Props) {
  const [phase, setPhase] = useState<ResearchPhase>("planning");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [fetchedSummary, setFetchedSummary] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    const es = new EventSource(
      `/api/research?listing_id=${encodeURIComponent(listingId)}`,
    );
    es.onmessage = (e) => {
      let ev: ResearchEvent;
      try {
        ev = JSON.parse(e.data) as ResearchEvent;
      } catch {
        return;
      }
      switch (ev.type) {
        case "phase":
          setPhase(ev.name);
          break;
        case "fetched":
          setFetchedSummary(ev.summary);
          break;
        case "delta":
          setText((t) => t + ev.text);
          break;
        case "complete":
          setPhase("complete");
          setTraceId(ev.trace_id);
          es.close();
          break;
        case "error":
          setError(ev.message);
          setPhase("error");
          es.close();
          break;
        // ignore "planned" for now (we surface fetcher list via summary instead)
      }
    };
    es.onerror = () => {
      // EventSource fires onerror on completion as well as on real errors.
      // Only treat it as a real error if we have not seen "complete".
      setPhase((p) => (p === "complete" ? p : "error"));
      es.close();
    };
    return () => es.close();
  }, [listingId]);

  // Parse the streamed text into bullets. Keep a partial trailing line
  // visible while it is being typed.
  const { bullets, trailing } = useMemo(() => {
    const lines = text.split("\n");
    const complete: string[] = [];
    let trailing = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const isLast = i === lines.length - 1;
      if (line.startsWith("- ")) {
        const stripped = line.slice(2).trim();
        if (isLast && !text.endsWith("\n")) {
          trailing = stripped;
        } else if (stripped) {
          complete.push(stripped);
        }
      }
    }
    return { bullets: complete, trailing };
  }, [text]);

  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">
          Neighborhood brief
        </h3>
        <PhaseBadge phase={phase} />
      </div>

      {fetchedSummary && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            Sources ({Object.keys(fetchedSummary).length})
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {Object.entries(fetchedSummary).map(([k, v]) => (
              <li key={k}>
                <span className="font-mono">{k}</span>: {v}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ul className="mt-3 space-y-2 text-sm">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="flex gap-2 leading-relaxed text-foreground"
          >
            <span className="text-muted-foreground">{i + 1}.</span>
            <span>{b}</span>
          </li>
        ))}
        {trailing && (
          <li className="flex gap-2 leading-relaxed text-foreground/70">
            <span className="text-muted-foreground">
              {bullets.length + 1}.
            </span>
            <span>{trailing}</span>
            <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-foreground/40" />
          </li>
        )}
      </ul>

      {bullets.length === 0 && !trailing && phase !== "error" && (
        <SkeletonBullets />
      )}

      {error && (
        <div className="mt-3 rounded-md bg-destructive/5 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {traceId && (
        <p className="mt-3 text-[10px] text-muted-foreground">
          trace: <span className="font-mono">{traceId.slice(0, 8)}</span>
          {" · "}phases: planner → fetchers → synthesizer (Llama 3.3 70B + Llama 3.1 405B)
        </p>
      )}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: ResearchPhase }) {
  const labels: Record<ResearchPhase, string> = {
    planning: "Planning",
    fetching: "Fetching",
    synthesizing: "Synthesizing",
    complete: "Done",
    error: "Error",
  };
  const Icon =
    phase === "complete"
      ? CheckCircle2
      : phase === "error"
        ? AlertCircle
        : Loader2;
  const spin =
    phase !== "complete" && phase !== "error" ? "animate-spin" : "";
  const color =
    phase === "complete"
      ? "text-emerald-600"
      : phase === "error"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] ${color}`}
    >
      <Icon className={`h-3 w-3 ${spin}`} />
      {labels[phase]}
    </span>
  );
}

function SkeletonBullets() {
  return (
    <ul className="mt-3 space-y-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="flex gap-2">
          <span className="h-4 w-4 rounded bg-muted/70" />
          <span
            className="h-4 flex-1 rounded bg-muted/70"
            style={{ maxWidth: `${60 + ((i * 7) % 30)}%` }}
          />
        </li>
      ))}
    </ul>
  );
}
