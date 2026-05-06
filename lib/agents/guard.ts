// FairHousingGuard. Runs on every user input and every assistant output.
//
// Returns { ok: true } when the content is safe, { ok: false, reason } when
// it implies a preference based on a protected class under the federal Fair
// Housing Act (race, color, religion, national origin, sex, family status,
// disability) or steers toward/away from neighborhoods on demographic basis.
//
// Model: NVIDIA NIM meta/llama-3.3-70b-instruct via the OpenAI SDK.

import { getNvidia, Models } from "../llm";
import { endSpan, startSpan } from "../tracing";
import type { GuardResult } from "../types";

const SYSTEM_PROMPT = `You are a Fair Housing Act compliance check for a real estate assistant.

Block content that:
- Asks for or implies preferences based on race, color, religion, national origin, sex, family status, or disability
- Steers users toward or away from neighborhoods based on demographic composition
- Mentions individual people by name in a discriminatory context
- Uses coded language for protected classes (for example "good schools" alone is fine; "good schools meaning the right kind of families" is not)

Allow content about:
- Property features, price, size, condition
- Transit, walkability, distance to landmarks
- Aggregate neighborhood data (price trends, complaint counts, school ratings)

Output JSON only with this exact shape:
{ "ok": true } if safe
{ "ok": false, "reason": "<short>", "redacted": "<safe rewrite or empty string>" } if not safe

No prose, no markdown, no code fences. JSON only.`;

export async function checkFairHousing(
  text: string,
  trace: { traceId: string; parentSpanId: string | null },
  side: "input" | "output",
): Promise<GuardResult> {
  const span = startSpan({
    traceId: trace.traceId,
    parentSpanId: trace.parentSpanId,
    agent: "FairHousingGuard",
    kind: `guard.${side}`,
    model: Models.guard,
  });

  try {
    const client = getNvidia();
    const resp = await client.chat.completions.create({
      model: Models.guard,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseGuardJson(raw);
    endSpan(span, {
      input: text,
      output: parsed,
      tokens_in: resp.usage?.prompt_tokens,
      tokens_out: resp.usage?.completion_tokens,
      ok: true,
    });
    return parsed;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endSpan(span, {
      input: text,
      ok: false,
      error: message,
    });
    // Fail open: if the guard itself errors, do not block the request. Log
    // and let the request through. Better than refusing every query during
    // a NVIDIA outage.
    return { ok: true };
  }
}

function parseGuardJson(raw: string): GuardResult {
  // Strip any code fences in case the model adds them despite instructions.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const obj = JSON.parse(cleaned);
    if (typeof obj.ok === "boolean") {
      return {
        ok: obj.ok,
        reason: typeof obj.reason === "string" ? obj.reason : undefined,
        redacted:
          typeof obj.redacted === "string" && obj.redacted.length > 0
            ? obj.redacted
            : undefined,
      };
    }
  } catch {
    // fall through
  }
  // If the model returned malformed JSON, default to "ok". The post-check
  // pass will catch most issues anyway, and refusing every request on parse
  // errors hurts more than it helps.
  return { ok: true };
}
