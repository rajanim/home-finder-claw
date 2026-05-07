"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Scale, Building2 } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { ListingCard } from "@/components/ListingCard";
import { AgentActivityPanel } from "@/components/AgentActivity";
import { CompareDrawer } from "@/components/CompareDrawer";
import { VoiceButton } from "@/components/VoiceButton";
import type { Listing, SearchResponse } from "@/lib/types";

const ListingMap = dynamic(
  () => import("@/components/ListingMap").then((m) => m.ListingMap),
  { ssr: false, loading: () => <div className="h-full w-full bg-muted/20" /> },
);

type Status =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "ready"; query: string; data: SearchResponse }
  | { kind: "error"; query: string; message: string };

const MAX_COMPARE = 4;

export default function Home() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const onSearch = useCallback(async (query: string) => {
    setStatus({ kind: "loading", query });
    setActiveId(null);
    setSelectedIds([]);
    try {
      const resp = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setStatus({
          kind: "error",
          query,
          message: err.error ?? `HTTP ${resp.status}`,
        });
        return;
      }
      const data = (await resp.json()) as SearchResponse;
      setStatus({ kind: "ready", query, data });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ kind: "error", query, message });
    }
  }, []);

  const onToggleCompare = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  }, []);

  const listings: Listing[] =
    status.kind === "ready" ? status.data.listings : [];

  const selectedListings = useMemo(
    () => selectedIds.map((id) => listings.find((l) => l.listing_id === id)).filter(
      (l): l is Listing => l !== undefined,
    ),
    [selectedIds, listings],
  );

  return (
    <main className="flex h-full min-h-screen flex-1 flex-col">
      <header className="border-b border-border bg-gradient-to-r from-primary/8 via-background to-background px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold leading-tight tracking-tight text-primary">
              Home Finder Claw
            </h1>
            <span className="text-xs text-muted-foreground">
              New York City real estate search, powered by agentic AI
            </span>
          </div>
          <a
            href="/eval"
            className="ml-auto text-sm font-medium text-primary hover:underline"
          >
            Eval dashboard →
          </a>
        </div>
      </header>

      <section className="border-b border-border bg-background px-6 py-5">
        <div className="mx-auto max-w-7xl">
          <SearchBar
            onSearch={onSearch}
            pending={status.kind === "loading"}
            voiceSlot={
              <VoiceButton
                onSearchResult={(data) =>
                  setStatus({
                    kind: "ready",
                    query: "(voice)",
                    data,
                  })
                }
              />
            }
          />
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-h-[60vh] flex-col gap-3 overflow-y-auto lg:max-h-[calc(100vh-260px)]">
          {status.kind === "idle" && (
            <EmptyState message="Type a query above to begin." />
          )}
          {status.kind === "loading" && (
            <EmptyState message={`Searching for "${status.query}"...`} />
          )}
          {status.kind === "error" && (
            <ErrorState message={status.message} />
          )}
          {status.kind === "ready" && (
            <ResultsList
              data={status.data}
              activeId={activeId}
              setActiveId={setActiveId}
              selectedIds={selectedIds}
              onToggleCompare={onToggleCompare}
            />
          )}
        </div>
        <div className="min-h-[60vh] lg:max-h-[calc(100vh-260px)] lg:sticky lg:top-4">
          <ListingMap
            listings={listings}
            activeId={activeId}
            onMarkerClick={setActiveId}
          />
        </div>
      </section>

      {/* Floating compare bar */}
      {selectedListings.length >= 2 && !compareOpen && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <button
            type="button"
            onClick={() => setCompareOpen(true)}
            className="flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:-translate-y-0.5"
          >
            <Scale className="h-4 w-4" />
            Compare {selectedListings.length} listings
          </button>
        </div>
      )}

      <CompareDrawer
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        selected={selectedListings}
      />
    </main>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      <div className="font-medium">Search failed</div>
      <div className="mt-1 text-destructive/80">{message}</div>
    </div>
  );
}

function ResultsList({
  data,
  activeId,
  setActiveId,
  selectedIds,
  onToggleCompare,
}: {
  data: SearchResponse;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  selectedIds: string[];
  onToggleCompare: (id: string) => void;
}) {
  const refused = !data.guard_pre.ok;
  if (refused) {
    return (
      <>
        <div className="rounded-md border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
          <div className="font-medium text-amber-900 dark:text-amber-200">
            The query was refused by the Fair Housing guard.
          </div>
          <div className="mt-1 text-amber-800 dark:text-amber-300">
            {data.guard_pre.reason ??
              "Search assistance is limited to property features, transit, schools, and prices."}
          </div>
        </div>
        <AgentActivityPanel
          activity={data.agent_activity}
          traceId={data.trace_id}
          defaultOpen
        />
      </>
    );
  }
  if (data.listings.length === 0) {
    return (
      <>
        <EmptyState message="No listings matched. Try loosening filters." />
        <AgentActivityPanel
          activity={data.agent_activity}
          traceId={data.trace_id}
        />
      </>
    );
  }
  const selectionFull = selectedIds.length >= MAX_COMPARE;
  return (
    <>
      <IntentSummary data={data} />
      <AgentActivityPanel
        activity={data.agent_activity}
        traceId={data.trace_id}
      />
      {data.listings.map((l) => (
        <ListingCard
          key={l.listing_id}
          listing={l}
          active={l.listing_id === activeId}
          selected={selectedIds.includes(l.listing_id)}
          selectionFull={selectionFull}
          onHover={setActiveId}
          onClick={setActiveId}
          onToggleCompare={onToggleCompare}
        />
      ))}
    </>
  );
}

function IntentSummary({ data }: { data: SearchResponse }) {
  const f = data.intent.filters;
  const chips: string[] = [];
  if (f.borough) chips.push(f.borough);
  if (f.beds_min !== undefined) chips.push(`${f.beds_min}+ bed`);
  if (f.baths_min !== undefined) chips.push(`${f.baths_min}+ bath`);
  if (f.price_max !== undefined)
    chips.push(`<= $${(f.price_max / 1000).toFixed(0)}k`);
  if (f.price_min !== undefined)
    chips.push(`>= $${(f.price_min / 1000).toFixed(0)}k`);
  if (data.intent.geo)
    chips.push(
      `near ${data.intent.geo.landmark_or_subway} (${data.intent.geo.radius_m} m)`,
    );
  return (
    <div className="rounded-md bg-muted/40 p-3 text-xs">
      <div className="text-muted-foreground">
        {data.listings.length} result{data.listings.length === 1 ? "" : "s"}
        {chips.length > 0 && (
          <>
            {" "}for{" "}
            {chips.map((c, i) => (
              <span key={c}>
                <span className="rounded bg-background px-1.5 py-0.5 font-medium">
                  {c}
                </span>
                {i < chips.length - 1 && " "}
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
