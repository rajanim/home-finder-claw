// Tracing helpers. Every agent and tool call gets a span. All spans for one
// request share a trace_id. At the end of the request, flushTrace() bulk
// indexes the buffered spans into traces-v1 so the eval dashboard can read
// them.
//
// State is per-process (a Map keyed by trace_id). On Vercel each request runs
// in an isolated function instance, so the buffer for one trace cannot leak
// into another. flushTrace() always clears its buffer.

import { randomUUID } from "node:crypto";
import { getOpenSearch, Indexes } from "./opensearch";

type Span = {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  agent: string;
  kind: string;
  started_at: string;
  ended_at: string;
  latency_ms: number;
  tokens_in?: number;
  tokens_out?: number;
  model?: string;
  input?: string;
  output?: string;
  ok: boolean;
  error?: string;
};

export type SpanCtx = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  agent: string;
  kind: string;
  model?: string;
  startedAt: number;
};

const buffers = new Map<string, Span[]>();

export function startTrace(): string {
  const id = randomUUID();
  buffers.set(id, []);
  return id;
}

export function startSpan(args: {
  traceId: string;
  agent: string;
  kind: string;
  parentSpanId?: string | null;
  model?: string;
}): SpanCtx {
  return {
    traceId: args.traceId,
    spanId: randomUUID(),
    parentSpanId: args.parentSpanId ?? null,
    agent: args.agent,
    kind: args.kind,
    model: args.model,
    startedAt: Date.now(),
  };
}

export function endSpan(
  ctx: SpanCtx,
  result: {
    input?: unknown;
    output?: unknown;
    tokens_in?: number;
    tokens_out?: number;
    ok: boolean;
    error?: string;
  },
): void {
  const ended = Date.now();
  const span: Span = {
    trace_id: ctx.traceId,
    span_id: ctx.spanId,
    parent_span_id: ctx.parentSpanId,
    agent: ctx.agent,
    kind: ctx.kind,
    started_at: new Date(ctx.startedAt).toISOString(),
    ended_at: new Date(ended).toISOString(),
    latency_ms: ended - ctx.startedAt,
    model: ctx.model,
    input: truncate(stringify(result.input)),
    output: truncate(stringify(result.output)),
    tokens_in: result.tokens_in,
    tokens_out: result.tokens_out,
    ok: result.ok,
    error: result.error,
  };
  const buf = buffers.get(ctx.traceId);
  if (buf) buf.push(span);
}

function stringify(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function truncate(s: string | undefined, max = 4000): string | undefined {
  if (s === undefined) return undefined;
  return s.length > max ? s.slice(0, max) + "...[truncated]" : s;
}

let tracesIndexEnsured = false;

async function ensureTracesIndex(): Promise<void> {
  if (tracesIndexEnsured) return;
  const client = getOpenSearch();
  const exists = await client.indices.exists({ index: Indexes.traces });
  // opensearch-js returns body wrapped; older versions returned a boolean.
  // Normalize.
  const indexExists =
    typeof (exists as unknown as { body?: boolean }).body === "boolean"
      ? (exists as unknown as { body: boolean }).body
      : (exists as unknown as boolean);
  if (!indexExists) {
    await client.indices.create({
      index: Indexes.traces,
      body: {
        settings: { index: { number_of_shards: 1, number_of_replicas: 0 } },
        mappings: {
          properties: {
            trace_id: { type: "keyword" },
            span_id: { type: "keyword" },
            parent_span_id: { type: "keyword" },
            agent: { type: "keyword" },
            kind: { type: "keyword" },
            started_at: { type: "date" },
            ended_at: { type: "date" },
            latency_ms: { type: "integer" },
            tokens_in: { type: "integer" },
            tokens_out: { type: "integer" },
            model: { type: "keyword" },
            input: { type: "text" },
            output: { type: "text" },
            ok: { type: "boolean" },
            error: { type: "text" },
          },
        },
      },
    });
  }
  tracesIndexEnsured = true;
}

export async function flushTrace(traceId: string): Promise<number> {
  const spans = buffers.get(traceId) ?? [];
  buffers.delete(traceId);
  if (spans.length === 0) return 0;

  try {
    await ensureTracesIndex();
    const client = getOpenSearch();
    const body: Record<string, unknown>[] = [];
    for (const s of spans) {
      body.push({ index: { _index: Indexes.traces, _id: s.span_id } });
      body.push(s as unknown as Record<string, unknown>);
    }
    await client.bulk({ body, refresh: false });
    return spans.length;
  } catch (e) {
    // Tracing must never block the user-facing response.
    // Fall back to console so we still know something happened.
    console.error(
      "[tracing] flushTrace failed, dropped",
      spans.length,
      "spans:",
      e,
    );
    return 0;
  }
}
