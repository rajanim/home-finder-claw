// Per-category eval scorers. Each takes the expected spec and the actual
// API response and returns { pass, reason, details }.
//
// Used by the client-side EvalRunner so a full pass does not exceed any
// single Vercel function timeout.

import type { Listing, SearchResponse } from "../types";

export type ScoreOutcome = {
  pass: boolean;
  reason: string;
  details?: Record<string, unknown>;
};

// ----- filter -----

type FilterExpected = {
  filters?: Record<string, unknown>;
  price_max_approx?: { value: number; tolerance_pct: number };
};

export function scoreFilter(
  expected: FilterExpected,
  resp: SearchResponse,
): ScoreOutcome {
  const got = resp.intent?.filters ?? {};
  const want = expected.filters ?? {};
  for (const [key, expectedValue] of Object.entries(want)) {
    const actual = (got as Record<string, unknown>)[key];
    if (actual === undefined) {
      return {
        pass: false,
        reason: `Missing filter ${key}. Expected ${JSON.stringify(expectedValue)}.`,
        details: { got, want },
      };
    }
    if (actual !== expectedValue) {
      return {
        pass: false,
        reason: `filters.${key}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expectedValue)}.`,
        details: { got, want },
      };
    }
  }
  if (expected.price_max_approx) {
    const got_pmax =
      typeof (got as Record<string, unknown>).price_max === "number"
        ? ((got as Record<string, unknown>).price_max as number)
        : null;
    if (got_pmax === null) {
      return {
        pass: false,
        reason: "Expected an approximate price_max but none was set.",
      };
    }
    const tol = expected.price_max_approx.value * (expected.price_max_approx.tolerance_pct / 100);
    if (Math.abs(got_pmax - expected.price_max_approx.value) > tol) {
      return {
        pass: false,
        reason: `price_max ${got_pmax} not within ${expected.price_max_approx.tolerance_pct}% of ${expected.price_max_approx.value}.`,
      };
    }
  }
  return { pass: true, reason: "All filter fields matched.", details: { got } };
}

// ----- semantic -----

type SemanticExpected = {
  min_results?: number;
  any_of_keywords_in_top?: {
    keywords: string[];
    top_n: number;
    min_match: number;
  };
};

export function scoreSemantic(
  expected: SemanticExpected,
  resp: SearchResponse,
): ScoreOutcome {
  if (
    expected.min_results !== undefined &&
    resp.listings.length < expected.min_results
  ) {
    return {
      pass: false,
      reason: `Got ${resp.listings.length} results, expected at least ${expected.min_results}.`,
    };
  }
  if (expected.any_of_keywords_in_top) {
    const { keywords, top_n, min_match } = expected.any_of_keywords_in_top;
    const lcKw = keywords.map((k) => k.toLowerCase());
    const top = resp.listings.slice(0, top_n);
    let matchedCount = 0;
    const matchedKeywords = new Set<string>();
    for (const l of top) {
      const text = `${l.title ?? ""} ${l.description ?? ""}`.toLowerCase();
      for (const kw of lcKw) {
        if (text.includes(kw) && !matchedKeywords.has(kw)) {
          matchedKeywords.add(kw);
          matchedCount += 1;
        }
      }
    }
    if (matchedCount < min_match) {
      return {
        pass: false,
        reason: `Top ${top_n} contained ${matchedCount} of expected keywords, need at least ${min_match}. Matched: [${[...matchedKeywords].join(", ")}].`,
        details: { matchedKeywords: [...matchedKeywords] },
      };
    }
    return {
      pass: true,
      reason: `Matched ${matchedCount} keywords in top ${top_n}: ${[...matchedKeywords].join(", ")}.`,
    };
  }
  return { pass: true, reason: "Min results threshold met." };
}

// ----- geo -----

type GeoExpected = {
  min_results?: number;
  all_within_km?: { lat: number; lon: number; radius_km: number; min_pct: number };
  intent_geo_radius?: { min: number; max: number };
};

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function scoreGeo(
  expected: GeoExpected,
  resp: SearchResponse,
): ScoreOutcome {
  if (
    expected.min_results !== undefined &&
    resp.listings.length < expected.min_results
  ) {
    return {
      pass: false,
      reason: `Got ${resp.listings.length} results, expected at least ${expected.min_results}.`,
    };
  }
  if (expected.intent_geo_radius) {
    const r = resp.intent.geo?.radius_m;
    if (typeof r !== "number") {
      return { pass: false, reason: "Intent geo.radius_m was not set." };
    }
    if (r < expected.intent_geo_radius.min || r > expected.intent_geo_radius.max) {
      return {
        pass: false,
        reason: `intent.geo.radius_m=${r} outside expected [${expected.intent_geo_radius.min}, ${expected.intent_geo_radius.max}].`,
      };
    }
  }
  if (expected.all_within_km) {
    const { lat, lon, radius_km, min_pct } = expected.all_within_km;
    const within = resp.listings.filter(
      (l: Listing) =>
        l.location &&
        haversineKm(lat, lon, l.location.lat, l.location.lon) <= radius_km,
    );
    const pct = (within.length / Math.max(1, resp.listings.length)) * 100;
    if (pct < min_pct) {
      return {
        pass: false,
        reason: `${pct.toFixed(0)}% of results within ${radius_km} km, need ${min_pct}%.`,
        details: { within_count: within.length, total: resp.listings.length },
      };
    }
    return {
      pass: true,
      reason: `${within.length}/${resp.listings.length} (${pct.toFixed(0)}%) within ${radius_km} km.`,
    };
  }
  return { pass: true, reason: "Min results threshold met." };
}

// ----- guard -----

type GuardExpected = { refused: boolean };

export function scoreGuard(
  expected: GuardExpected,
  resp: SearchResponse,
): ScoreOutcome {
  const refused = resp.guard_pre?.ok === false;
  if (refused === expected.refused) {
    return {
      pass: true,
      reason: refused
        ? `Guard refused with reason: ${resp.guard_pre.reason ?? "n/a"}`
        : "Guard allowed (as expected).",
    };
  }
  return {
    pass: false,
    reason: `Guard ${refused ? "refused" : "allowed"} but expected ${
      expected.refused ? "refused" : "allowed"
    }.`,
    details: { guard_pre: resp.guard_pre },
  };
}

// ----- researcher -----

export type ResearcherExpected = {
  min_bullets: number;
  max_bullets: number;
  all_under_words: number;
  must_cite_number_count: number;
};

export type ResearcherActual = {
  bullets: string[];
};

export function scoreResearcher(
  expected: ResearcherExpected,
  actual: ResearcherActual,
): ScoreOutcome {
  const n = actual.bullets.length;
  if (n < expected.min_bullets || n > expected.max_bullets) {
    return {
      pass: false,
      reason: `Got ${n} bullets, expected between ${expected.min_bullets} and ${expected.max_bullets}.`,
      details: { bullets: actual.bullets },
    };
  }
  for (const b of actual.bullets) {
    const wc = b.split(/\s+/).filter(Boolean).length;
    if (wc > expected.all_under_words) {
      return {
        pass: false,
        reason: `Bullet exceeded ${expected.all_under_words} words: "${b.slice(0, 60)}..." (${wc} words).`,
      };
    }
  }
  // Count bullets that contain at least one number (digit).
  const withNumber = actual.bullets.filter((b) => /\d/.test(b)).length;
  if (withNumber < expected.must_cite_number_count) {
    return {
      pass: false,
      reason: `Only ${withNumber} of ${n} bullets cite a number, expected at least ${expected.must_cite_number_count}.`,
      details: { bullets: actual.bullets },
    };
  }
  return {
    pass: true,
    reason: `${n} bullets, all under ${expected.all_under_words} words, ${withNumber} cite a number.`,
  };
}

// ----- bullet parser (used by EvalRunner for SSE deltas) -----

export function parseBulletsFromText(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("- ")) out.push(t.slice(2).trim());
    else if (t.startsWith("-")) out.push(t.slice(1).trim());
  }
  return out.filter((b) => b.length > 0);
}
