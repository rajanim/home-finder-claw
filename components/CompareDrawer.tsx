"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { AgentActivityPanel } from "./AgentActivity";
import type { CompareResponse, Listing } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  selected: Listing[];
};

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: CompareResponse }
  | { kind: "error"; message: string };

function formatPrice(p: number): string {
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(2)}M`;
  if (p >= 1_000) return `$${Math.round(p / 1_000)}k`;
  return `$${p}`;
}

export function CompareDrawer({ open, onClose, selected }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (!open) return;
    if (selected.length < 2) return;
    setStatus({ kind: "loading" });
    fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listing_ids: selected.map((l) => l.listing_id),
      }),
    })
      .then(async (resp) => {
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setStatus({
            kind: "error",
            message: err.error ?? `HTTP ${resp.status}`,
          });
          return;
        }
        const data = (await resp.json()) as CompareResponse;
        setStatus({ kind: "ready", data });
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        setStatus({ kind: "error", message });
      });
  }, [open, selected]);

  // Close on escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog">
      <button
        type="button"
        aria-label="Close compare drawer"
        onClick={onClose}
        className="flex-1 bg-foreground/30"
      />
      <aside className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-background shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <div className="text-sm font-semibold">Compare listings</div>
            <div className="text-xs text-muted-foreground">
              {selected.length} selected
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">
          {status.kind === "idle" && null}
          {status.kind === "loading" && (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Comparing listings with Llama 3.3 70B...
            </div>
          )}
          {status.kind === "error" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <div className="font-medium">Compare failed</div>
              <div className="mt-1 text-destructive/80">{status.message}</div>
            </div>
          )}
          {status.kind === "ready" && (
            <CompareTable data={status.data} selected={selected} />
          )}
        </div>
      </aside>
    </div>
  );
}

function CompareTable({
  data,
  selected,
}: {
  data: CompareResponse;
  selected: Listing[];
}) {
  // Use the listings the API returned (in case order or membership differs)
  // but fall back to the user's selection to keep order stable in the UI.
  const listings = data.listings.length > 0 ? data.listings : selected;
  return (
    <div className="space-y-5">
      {/* Header with thumbnails */}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `minmax(120px, 0.8fr) repeat(${listings.length}, minmax(0, 1fr))`,
        }}
      >
        <div />
        {listings.map((l) => (
          <div key={l.listing_id} className="overflow-hidden">
            {l.photos?.[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={l.photos[0]}
                alt={l.title}
                className="h-24 w-full rounded-md object-cover"
              />
            ) : (
              <div className="h-24 w-full rounded-md bg-muted" />
            )}
            <div className="mt-2 text-sm font-semibold tabular-nums">
              {formatPrice(l.price)}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {l.borough} {l.zip}
            </div>
          </div>
        ))}
      </div>

      {/* Comparison rows */}
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <tbody>
            {data.result.rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <th
                  scope="row"
                  className="bg-muted/40 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {row.feature}
                </th>
                {row.values.map((v, j) => (
                  <td
                    key={j}
                    className="border-l border-border px-3 py-2 align-top"
                  >
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tradeoffs paragraph */}
      <div className="rounded-md border bg-muted/30 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tradeoffs
        </div>
        <p className="mt-2 text-sm leading-relaxed">{data.result.tradeoffs}</p>
      </div>

      {/* Agent activity */}
      <AgentActivityPanel
        activity={data.agent_activity}
        traceId={data.trace_id}
        defaultOpen={false}
      />
    </div>
  );
}
