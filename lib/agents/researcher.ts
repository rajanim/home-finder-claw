// NeighborhoodResearcher. Three sub-agents:
//   1. Planner   - meta/llama-3.3-70b-instruct picks which fetchers to call
//   2. Fetchers  - deterministic OpenSearch reads against neighborhoods-v1
//                  and zhvi-v1 (no LLM)
//   3. Synthesizer - meta/llama-3.1-405b-instruct writes 5 bullets, streamed
//
// The synthesizer is an async generator: callers iterate `for await` and
// forward each token to the SSE stream so the user sees bullets fill in.

import { getNvidia, Models, withNvidiaRetry } from "../llm";
import { getOpenSearch, Indexes } from "../opensearch";
import { endSpan, startSpan } from "../tracing";
import type { FetcherName, Listing } from "../types";

const ALL_FETCHERS: FetcherName[] = [
  "getZhvi",
  "getComplaints",
  "getSchools",
  "getTransit",
];

const PLANNER_PROMPT = `You pick which data sources to read for a NYC neighborhood brief.

Available fetchers:
- getZhvi: 12 months of Zillow Home Value Index for the ZIP
- getComplaints: 311 noise and rodent complaint counts (last 12 months)
- getSchools: list of public schools in the ZIP with their ratings
- getTransit: nearest subway info and lines for the ZIP

Always include getZhvi and getComplaints. Add getSchools and getTransit when they would help.

Output JSON only with this exact shape:
{ "fetchers": ["getZhvi", "getComplaints", "getSchools", "getTransit"] }

No prose, no markdown, no code fences.`;

const SYNTH_PROMPT = `You write neighborhood briefs for home shoppers in NYC.

Rules:
- Exactly five bullets.
- Each bullet under 25 words.
- Cite a number in at least three bullets.
- Do not use the words "vibrant", "charming", "diverse", or any phrase that could imply demographic preferences.
- If a fetcher returned no data for a topic, do not mention that topic at all.
- Never mention crime statistics tied to a specific demographic group.
- Bullets cover (in any order, but only when data exists): price trend, transit, schools, complaint mix, one specific tip.

Format: exactly five lines, each line starts with "- ", separated by single newlines. No header, no preamble, no markdown after the dash. Lines only.`;

// ----- Fetcher result types -----

type ZhviPoint = { month: string; value: number; yoy: number | null };
type ZhviResult = {
  zip: string;
  months: ZhviPoint[];
  trend_12mo_pct: number | null;
};

type ComplaintsResult = {
  zip: string;
  noise_complaints_12m: number;
  rodent_complaints_12m: number;
  median_price: number | null;
};

type SchoolsResult = {
  zip: string;
  schools: Array<{ name: string; rating: number; level: string }>;
};

type TransitResult = {
  zip: string;
  nearest_subway: string;
  subway_distance_m: number;
  subway_lines: string[];
};

export type Fetched = {
  zhvi?: ZhviResult;
  complaints?: ComplaintsResult;
  schools?: SchoolsResult;
  transit?: TransitResult;
};

type TraceCtx = { traceId: string; parentSpanId: string | null };

// ----- Planner -----

export async function planFetchers(
  context: { zip: string; borough: string },
  trace: TraceCtx,
): Promise<FetcherName[]> {
  const span = startSpan({
    traceId: trace.traceId,
    parentSpanId: trace.parentSpanId,
    agent: "NeighborhoodResearcher.Planner",
    kind: "llm.chat",
    model: Models.researcher_planner,
  });

  try {
    const client = getNvidia();
    const resp = await withNvidiaRetry(() =>
      client.chat.completions.create({
        model: Models.researcher_planner,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PLANNER_PROMPT },
          {
            role: "user",
            content: JSON.stringify({ zip: context.zip, borough: context.borough }),
          },
        ],
      }),
    );
    const raw = resp.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parsePlannerJson(raw);
    endSpan(span, {
      input: context,
      output: parsed,
      tokens_in: resp.usage?.prompt_tokens,
      tokens_out: resp.usage?.completion_tokens,
      ok: true,
    });
    return parsed;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endSpan(span, { input: context, ok: false, error: message });
    // Fail safe: ask all fetchers.
    return ALL_FETCHERS;
  }
}

function parsePlannerJson(raw: string): FetcherName[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const obj = JSON.parse(cleaned);
    const list = Array.isArray(obj) ? obj : obj.fetchers;
    if (!Array.isArray(list)) return ALL_FETCHERS;
    const valid = list.filter((s): s is FetcherName =>
      ALL_FETCHERS.includes(s as FetcherName),
    );
    return valid.length > 0 ? valid : ALL_FETCHERS;
  } catch {
    return ALL_FETCHERS;
  }
}

// ----- Fetchers -----

async function getZhvi(zip: string): Promise<ZhviResult> {
  const client = getOpenSearch();
  const resp = await client.search({
    index: Indexes.zhvi,
    body: {
      size: 12,
      query: { term: { zip } },
      sort: [{ month: "desc" }],
    },
  });
  const respBody = (resp as unknown as { body?: unknown }).body ?? resp;
  const hits =
    ((respBody as Record<string, unknown>).hits as Record<string, unknown>) || {};
  type ZhviSource = {
    month: string;
    zhvi_value: number;
    yoy_change: number | null;
  };
  const arr = (hits.hits as Array<{ _source: ZhviSource }>) || [];
  const months: ZhviPoint[] = arr.map((h) => ({
    month: h._source.month,
    value: h._source.zhvi_value,
    yoy: h._source.yoy_change ?? null,
  }));
  // Compute simple 12-month trend if we have it.
  let trend: number | null = null;
  if (months.length >= 2) {
    const oldest = months[months.length - 1].value;
    const newest = months[0].value;
    if (typeof oldest === "number" && oldest > 0 && typeof newest === "number") {
      trend = ((newest - oldest) / oldest) * 100;
    }
  }
  return { zip, months, trend_12mo_pct: trend };
}

async function getComplaints(zip: string): Promise<ComplaintsResult> {
  const client = getOpenSearch();
  const resp = await client.search({
    index: Indexes.neighborhoods,
    body: { size: 1, query: { term: { zip } } },
  });
  const respBody = (resp as unknown as { body?: unknown }).body ?? resp;
  const hits =
    ((respBody as Record<string, unknown>).hits as Record<string, unknown>) || {};
  const arr = (hits.hits as Array<{ _source: Record<string, unknown> }>) || [];
  const src = arr[0]?._source ?? {};
  return {
    zip,
    noise_complaints_12m: (src.noise_complaints_12m as number) ?? 0,
    rodent_complaints_12m: (src.rodent_complaints_12m as number) ?? 0,
    median_price:
      typeof src.median_price === "number" && src.median_price > 0
        ? (src.median_price as number)
        : null,
  };
}

async function getSchools(zip: string): Promise<SchoolsResult> {
  const client = getOpenSearch();
  const resp = await client.search({
    index: Indexes.neighborhoods,
    body: { size: 1, query: { term: { zip } } },
  });
  const respBody = (resp as unknown as { body?: unknown }).body ?? resp;
  const hits =
    ((respBody as Record<string, unknown>).hits as Record<string, unknown>) || {};
  const arr = (hits.hits as Array<{ _source: Record<string, unknown> }>) || [];
  const src = arr[0]?._source ?? {};
  const schoolsRaw = src.schools as
    | Array<{ name: string; rating: number; level: string }>
    | undefined;
  return { zip, schools: Array.isArray(schoolsRaw) ? schoolsRaw : [] };
}

async function getTransit(listing: Listing): Promise<TransitResult> {
  const client = getOpenSearch();
  const resp = await client.search({
    index: Indexes.neighborhoods,
    body: { size: 1, query: { term: { zip: listing.zip } } },
  });
  const respBody = (resp as unknown as { body?: unknown }).body ?? resp;
  const hits =
    ((respBody as Record<string, unknown>).hits as Record<string, unknown>) || {};
  const arr = (hits.hits as Array<{ _source: Record<string, unknown> }>) || [];
  const src = arr[0]?._source ?? {};
  const lines =
    (Array.isArray(src.subway_lines) ? src.subway_lines : []) as string[];
  return {
    zip: listing.zip,
    nearest_subway: listing.nearest_subway,
    subway_distance_m: listing.subway_distance_m,
    subway_lines: lines,
  };
}

export async function runFetchers(
  fetchers: FetcherName[],
  context: { zip: string; listing: Listing },
  trace: TraceCtx,
): Promise<Fetched> {
  const out: Fetched = {};
  await Promise.all(
    fetchers.map(async (name) => {
      const span = startSpan({
        traceId: trace.traceId,
        parentSpanId: trace.parentSpanId,
        agent: "NeighborhoodResearcher.Fetchers",
        kind: `tool.${name}`,
      });
      try {
        switch (name) {
          case "getZhvi":
            out.zhvi = await getZhvi(context.zip);
            endSpan(span, { ok: true, output: { months: out.zhvi.months.length } });
            break;
          case "getComplaints":
            out.complaints = await getComplaints(context.zip);
            endSpan(span, { ok: true, output: out.complaints });
            break;
          case "getSchools":
            out.schools = await getSchools(context.zip);
            endSpan(span, { ok: true, output: { count: out.schools.schools.length } });
            break;
          case "getTransit":
            out.transit = await getTransit(context.listing);
            endSpan(span, { ok: true, output: out.transit });
            break;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        endSpan(span, { ok: false, error: message });
        // Soft fail: leave out[name] undefined so the synthesizer omits the topic.
      }
    }),
  );
  return out;
}

export function summarizeFetched(f: Fetched): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.zhvi)
    out.zhvi = `${f.zhvi.months.length} months, trend ${f.zhvi.trend_12mo_pct?.toFixed(1) ?? "?"}%`;
  if (f.complaints) {
    const median = f.complaints.median_price
      ? `, median price $${(f.complaints.median_price / 1000).toFixed(0)}k`
      : "";
    out.complaints = `noise=${f.complaints.noise_complaints_12m} rodent=${f.complaints.rodent_complaints_12m}${median}`;
  }
  if (f.schools) out.schools = `${f.schools.schools.length} schools`;
  if (f.transit)
    out.transit = `${f.transit.nearest_subway} (${f.transit.subway_distance_m}m), lines: ${f.transit.subway_lines.join(", ") || "n/a"}`;
  return out;
}

// ----- Synthesizer (streaming) -----

export async function* synthesizeBullets(
  fetched: Fetched,
  trace: TraceCtx,
): AsyncGenerator<string, void, void> {
  const span = startSpan({
    traceId: trace.traceId,
    parentSpanId: trace.parentSpanId,
    agent: "NeighborhoodResearcher.Synthesizer",
    kind: "llm.chat",
    model: Models.researcher_synth,
  });

  let full = "";
  try {
    const client = getNvidia();
    const stream = await withNvidiaRetry(() =>
      client.chat.completions.create({
        model: Models.researcher_synth,
        temperature: 0.3,
        max_tokens: 600,
        stream: true,
        messages: [
          { role: "system", content: SYNTH_PROMPT },
          { role: "user", content: JSON.stringify(fetched) },
        ],
      }),
    );
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        full += delta;
        yield delta;
      }
    }
    endSpan(span, { input: fetched, output: full, ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endSpan(span, { input: fetched, output: full, ok: false, error: message });
    throw e;
  }
}
