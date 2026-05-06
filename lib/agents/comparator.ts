// Comparator. Takes 2 to 4 Listing objects and returns a structured table
// plus a tradeoffs paragraph.
//
// We ask for JSON instead of markdown so the UI can render a real HTML
// table with consistent styling, and so cells stay bounded in length.
//
// Model: NVIDIA NIM meta/llama-3.3-70b-instruct.

import { getNvidia, Models } from "../llm";
import { endSpan, startSpan } from "../tracing";
import type { CompareResult, Listing } from "../types";

const SYSTEM_PROMPT = `You compare 2 to 4 NYC real estate listings for a home shopper.

Output valid JSON only with this shape:
{
  "rows": [
    { "feature": "Price", "values": ["$X", "$Y", ...] },
    { "feature": "Beds / Baths", "values": [...] },
    { "feature": "Borough / ZIP", "values": [...] },
    { "feature": "Nearest subway", "values": [...] },
    { "feature": "Year built", "values": [...] },
    { "feature": "Size (sqft)", "values": [...] }
  ],
  "tradeoffs": "<one paragraph, 2 to 4 sentences, plain language>"
}

Rules:
- Each "values" array length must equal the number of listings.
- Each cell stays under 60 characters.
- Use "n/a" when a field is missing in the source listing.
- The tradeoffs paragraph names the 2 or 3 most decision-relevant differences.
- Never mention or imply protected classes (race, religion, family status, national origin, sex, disability).
- Never use the words "vibrant", "charming", "diverse", or coded demographic phrases.
- No preamble. No code fences. JSON only.`;

function summarize(listing: Listing): Record<string, unknown> {
  return {
    listing_id: listing.listing_id,
    price: listing.price,
    beds: listing.beds,
    baths: listing.baths,
    borough: listing.borough,
    zip: listing.zip,
    nearest_subway: listing.nearest_subway,
    subway_distance_m: listing.subway_distance_m,
    year_built: listing.year_built ?? null,
    house_size_sqft: listing.house_size_sqft ?? null,
    property_type: listing.property_type,
  };
}

export async function compareListings(
  listings: Listing[],
  trace: { traceId: string; parentSpanId: string | null },
): Promise<CompareResult> {
  if (listings.length < 2 || listings.length > 4) {
    throw new Error(
      `Comparator needs 2 to 4 listings, got ${listings.length}`,
    );
  }

  const span = startSpan({
    traceId: trace.traceId,
    parentSpanId: trace.parentSpanId,
    agent: "Comparator",
    kind: "llm.chat",
    model: Models.comparator,
  });

  try {
    const client = getNvidia();
    const resp = await client.chat.completions.create({
      model: Models.comparator,
      temperature: 0,
      max_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ listings: listings.map(summarize) }),
        },
      ],
    });
    const raw = resp.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseCompareJson(raw, listings.length);
    endSpan(span, {
      input: { count: listings.length },
      output: { rows: parsed.rows.length, tradeoffs_chars: parsed.tradeoffs.length },
      tokens_in: resp.usage?.prompt_tokens,
      tokens_out: resp.usage?.completion_tokens,
      ok: true,
    });
    return parsed;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endSpan(span, {
      input: { count: listings.length },
      ok: false,
      error: message,
    });
    throw e;
  }
}

function parseCompareJson(raw: string, n: number): CompareResult {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return fallback(n);
  }
  const rowsRaw = obj.rows;
  const tradeoffsRaw = obj.tradeoffs;
  if (!Array.isArray(rowsRaw) || typeof tradeoffsRaw !== "string") {
    return fallback(n);
  }
  const rows: CompareResult["rows"] = [];
  for (const r of rowsRaw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    if (typeof rec.feature !== "string") continue;
    if (!Array.isArray(rec.values)) continue;
    const values = rec.values.map((v) =>
      typeof v === "string" ? v.slice(0, 80) : String(v).slice(0, 80),
    );
    if (values.length !== n) {
      // Pad or truncate so the UI never explodes on a malformed row.
      while (values.length < n) values.push("n/a");
      values.length = n;
    }
    rows.push({ feature: rec.feature, values });
  }
  if (rows.length === 0) return fallback(n);
  return { rows, tradeoffs: tradeoffsRaw.trim() };
}

function fallback(n: number): CompareResult {
  return {
    rows: [
      {
        feature: "Comparison unavailable",
        values: Array(n).fill("n/a"),
      },
    ],
    tradeoffs: "The comparator returned malformed output. Try again.",
  };
}
