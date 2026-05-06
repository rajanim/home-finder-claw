"use client";

import { useState } from "react";
import { Brain, Database, Search as SearchIcon, Sparkles, Shield, ChevronDown, ChevronRight } from "lucide-react";
import type { AgentActivity as Activity } from "@/lib/types";

type Props = {
  activity: Activity[];
  traceId?: string;
  defaultOpen?: boolean;
};

// Map kind -> icon. Falls back to Brain for unknown kinds.
function iconFor(kind: string) {
  if (kind.startsWith("guard.")) return Shield;
  if (kind === "llm.embed") return SearchIcon;
  if (kind === "llm.chat") return Sparkles;
  if (kind.startsWith("tool.")) return Database;
  return Brain;
}

function totalLatencyMs(activity: Activity[]): number {
  return activity.reduce((s, a) => s + (a.latency_ms ?? 0), 0);
}

export function AgentActivityPanel({ activity, traceId, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  if (activity.length === 0) return null;
  const total = totalLatencyMs(activity);
  return (
    <div className="rounded-lg border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Brain className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">Agent activity</span>
        <span className="text-muted-foreground">
          {activity.length} step{activity.length === 1 ? "" : "s"}
          {" · "}
          {total} ms total
        </span>
        {traceId && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            trace {traceId.slice(0, 8)}
          </span>
        )}
      </button>
      {open && (
        <ol className="border-t border-border">
          {activity.map((a, i) => {
            const Icon = iconFor(a.kind);
            const ok = a.ok;
            return (
              <li
                key={i}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-2 border-b border-border px-3 py-2 last:border-b-0"
              >
                <div className="flex h-5 w-5 items-center justify-center rounded bg-muted">
                  <Icon className="h-3 w-3 text-foreground/70" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-medium">{a.agent}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {a.kind}
                    </span>
                    {a.model && (
                      <span className="rounded bg-primary/10 px-1.5 py-px font-mono text-[10px] text-primary">
                        {a.model}
                      </span>
                    )}
                    {!ok && (
                      <span className="rounded bg-destructive/10 px-1.5 py-px text-[10px] text-destructive">
                        error
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 break-words text-xs text-muted-foreground">
                    {a.summary}
                    {a.error && (
                      <span className="text-destructive"> ({a.error})</span>
                    )}
                  </div>
                </div>
                <div className="text-right text-[10px] tabular-nums text-muted-foreground">
                  <div>{a.latency_ms} ms</div>
                  {(a.tokens_in ?? a.tokens_out) !== undefined && (
                    <div>
                      {(a.tokens_in ?? 0) + (a.tokens_out ?? 0)} tok
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
