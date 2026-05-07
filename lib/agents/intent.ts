// IntentDecomposer. Parses a raw user query into a typed Intent object.
//
// Model: NVIDIA NIM meta/llama-3.3-70b-instruct.
//
// JSON output is enforced via response_format. We also guard against bad
// output with a defensive parser plus a sane default.

import { getNvidia, Models, withNvidiaRetry } from "../llm";
import { endSpan, startSpan } from "../tracing";
import type { Borough, Intent, IntentFilters } from "../types";

const SYSTEM_PROMPT = `You convert real estate search queries for New York City into structured intent.

Rules:
- Output JSON only that matches the schema below. No prose, no code fences.
- Never infer protected-class preferences. If the user asks for things tied to race, religion, family status, national origin, disability, or sex, leave the relevant filter empty and add the phrase to "flagged_phrases".
- If a price like "1.2M" is given, convert to integer 1200000.
- For subway references (such as "near the F train"), set geo.radius_m to 800.
- For "near a park", set geo.radius_m to 500.
- If the user says "Brooklyn", "Manhattan", "Queens", "Bronx", or "Staten Island", set filters.borough exactly to that string.
- Boroughs are the only valid values for filters.borough.

Schema:
{
  "semantic_query": string,
  "filters": {
    "price_max": integer or null,
    "price_min": integer or null,
    "beds_min": integer or null,
    "baths_min": integer or null,
    "borough": "Manhattan" | "Brooklyn" | "Queens" | "Bronx" | "Staten Island" | null,
    "property_type": string or null
  },
  "geo": { "landmark_or_subway": string, "radius_m": integer } or null,
  "must_have": string[],
  "nice_to_have": string[],
  "flagged_phrases": string[]
}`;

const VALID_BOROUGHS: Borough[] = [
  "Manhattan",
  "Brooklyn",
  "Queens",
  "Bronx",
  "Staten Island",
];

export async function decomposeIntent(
  query: string,
  trace: { traceId: string; parentSpanId: string | null },
): Promise<Intent> {
  const span = startSpan({
    traceId: trace.traceId,
    parentSpanId: trace.parentSpanId,
    agent: "IntentDecomposer",
    kind: "llm.chat",
    model: Models.intent,
  });

  try {
    const client = getNvidia();
    const resp = await withNvidiaRetry(() =>
      client.chat.completions.create({
        model: Models.intent,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: query },
        ],
      }),
    );
    const raw = resp.choices?.[0]?.message?.content?.trim() ?? "";
    const intent = parseIntent(raw, query);
    endSpan(span, {
      input: query,
      output: intent,
      tokens_in: resp.usage?.prompt_tokens,
      tokens_out: resp.usage?.completion_tokens,
      ok: true,
    });
    return intent;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endSpan(span, { input: query, ok: false, error: message });
    // Fail safe: a minimal intent that just runs a BM25 search on the query.
    return defaultIntent(query);
  }
}

function defaultIntent(query: string): Intent {
  return {
    semantic_query: query,
    filters: {},
    geo: null,
    must_have: [],
    nice_to_have: [],
    flagged_phrases: [],
  };
}

function parseIntent(raw: string, fallbackQuery: string): Intent {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return defaultIntent(fallbackQuery);
  }

  const filtersRaw = (obj.filters as Record<string, unknown>) || {};
  const filters: IntentFilters = {};
  if (typeof filtersRaw.price_max === "number") filters.price_max = filtersRaw.price_max;
  if (typeof filtersRaw.price_min === "number") filters.price_min = filtersRaw.price_min;
  if (typeof filtersRaw.beds_min === "number") filters.beds_min = filtersRaw.beds_min;
  if (typeof filtersRaw.baths_min === "number") filters.baths_min = filtersRaw.baths_min;
  if (
    typeof filtersRaw.borough === "string" &&
    VALID_BOROUGHS.includes(filtersRaw.borough as Borough)
  ) {
    filters.borough = filtersRaw.borough as Borough;
  }
  if (typeof filtersRaw.property_type === "string" && filtersRaw.property_type.length > 0) {
    filters.property_type = filtersRaw.property_type;
  }

  let geo: Intent["geo"] = null;
  const geoRaw = obj.geo as Record<string, unknown> | null | undefined;
  if (
    geoRaw &&
    typeof geoRaw.landmark_or_subway === "string" &&
    typeof geoRaw.radius_m === "number"
  ) {
    geo = {
      landmark_or_subway: geoRaw.landmark_or_subway,
      radius_m: geoRaw.radius_m,
    };
  }

  return {
    semantic_query:
      typeof obj.semantic_query === "string" && obj.semantic_query.length > 0
        ? obj.semantic_query
        : fallbackQuery,
    filters,
    geo,
    must_have: stringArray(obj.must_have),
    nice_to_have: stringArray(obj.nice_to_have),
    flagged_phrases: stringArray(obj.flagged_phrases),
  };
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}
