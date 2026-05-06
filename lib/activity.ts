// Translates raw spans from lib/tracing into user-facing AgentActivity
// entries. The supervisor calls this right before returning a response so
// the UI can render a "what each agent did" timeline.

import type { AgentActivity } from "./types";

type RawSpan = {
  agent: string;
  kind: string;
  model?: string;
  latency_ms: number;
  ok: boolean;
  error?: string;
  output?: string;
  input?: string;
  tokens_in?: number;
  tokens_out?: number;
  span_id: string;
  parent_span_id: string | null;
  started_at: string;
};

export function spansToActivity(spans: RawSpan[]): AgentActivity[] {
  // Sort by started_at so the timeline renders in execution order.
  const sorted = [...spans].sort((a, b) =>
    a.started_at.localeCompare(b.started_at),
  );
  // Skip the supervisor root span. It is implicit.
  const filtered = sorted.filter((s) => !s.kind.startsWith("supervisor."));
  return filtered.map((s) => ({
    agent: s.agent,
    kind: s.kind,
    model: s.model,
    latency_ms: s.latency_ms,
    ok: s.ok,
    error: s.error,
    summary: describeSpan(s),
    tokens_in: s.tokens_in,
    tokens_out: s.tokens_out,
  }));
}

function describeSpan(s: RawSpan): string {
  if (s.kind === "guard.input") {
    return s.ok
      ? "Checked the user query for protected-class language. Allowed."
      : `Refused user query: ${tryParseGuardReason(s.output) ?? "policy violation"}`;
  }
  if (s.kind === "guard.output") {
    return "Checked the response summary for compliance issues.";
  }
  if (s.agent === "IntentDecomposer") {
    const filters = tryParseIntentFilters(s.output);
    return filters
      ? `Parsed query into structured intent: ${filters}`
      : "Parsed user query into structured intent.";
  }
  if (s.agent === "HybridRetriever" && s.kind === "llm.embed") {
    const dim = tryParseEmbedDim(s.output);
    return `Embedded the semantic query (${dim ?? "?"}-dim vector).`;
  }
  if (s.agent === "HybridRetriever" && s.kind === "tool.opensearch") {
    const hits = tryParseHitCount(s.output);
    return `Hybrid OpenSearch query (BM25 + kNN + filters). ${
      hits !== null ? `${hits} hits.` : ""
    }`;
  }
  if (s.agent === "NeighborhoodResearcher.Planner") {
    return "Picked which neighborhood data sources to read.";
  }
  if (s.kind.startsWith("tool.get")) {
    const name = s.kind.replace("tool.", "");
    return `Fetched ${name.replace(/^get/, "").toLowerCase()} from OpenSearch.`;
  }
  if (s.agent === "NeighborhoodResearcher.Synthesizer") {
    return "Wrote the 5-bullet neighborhood brief from fetched data.";
  }
  if (s.agent === "Comparator") {
    return "Compared listings side-by-side and wrote tradeoffs.";
  }
  if (s.agent === "Comparator.Loader") {
    const found = tryParseFoundCount(s.output);
    return found !== null
      ? `Loaded ${found} listings from OpenSearch by id.`
      : "Loaded listings from OpenSearch by id.";
  }
  if (s.kind === "llm.chat") return "LLM chat completion.";
  return s.kind;
}

function tryParseFoundCount(raw: string | undefined): number | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return typeof obj.found === "number" ? obj.found : null;
  } catch {
    return null;
  }
}

function tryParseGuardReason(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return typeof obj.reason === "string" ? obj.reason : null;
  } catch {
    return null;
  }
}

function tryParseIntentFilters(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    const f = obj.filters ?? {};
    const parts: string[] = [];
    if (f.borough) parts.push(`borough=${f.borough}`);
    if (typeof f.beds_min === "number") parts.push(`beds>=${f.beds_min}`);
    if (typeof f.baths_min === "number") parts.push(`baths>=${f.baths_min}`);
    if (typeof f.price_max === "number")
      parts.push(`price<=$${(f.price_max / 1000).toFixed(0)}k`);
    if (typeof f.price_min === "number")
      parts.push(`price>=$${(f.price_min / 1000).toFixed(0)}k`);
    if (obj.geo?.landmark_or_subway)
      parts.push(`near ${obj.geo.landmark_or_subway}`);
    return parts.length > 0 ? `{${parts.join(", ")}}` : null;
  } catch {
    return null;
  }
}

function tryParseEmbedDim(raw: string | undefined): number | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return typeof obj.dim === "number" ? obj.dim : null;
  } catch {
    return null;
  }
}

function tryParseHitCount(raw: string | undefined): number | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return typeof obj.hit_count === "number" ? obj.hit_count : null;
  } catch {
    return null;
  }
}
