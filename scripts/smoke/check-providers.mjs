#!/usr/bin/env node
// scripts/smoke/check-providers.mjs
//
// Verifies NVIDIA NIM is reachable for both chat and embeddings, and that
// the chosen models respond with the expected shape. Optionally checks
// OpenAI if OPENAI_API_KEY is set (for Phase 5 voice prep).
//
// Usage:
//   node scripts/smoke/check-providers.mjs
//
// Reads NVIDIA_API_KEY and OPENAI_API_KEY from process.env. Loads .env.local
// if present (using built-in dotenv-style parsing, no extra dep).

import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal .env.local loader (only sets vars not already in process.env).
try {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // .env.local is optional; if missing, rely on the shell environment.
}

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const CHAT_MODEL = "meta/llama-3.3-70b-instruct";
const EMBED_MODEL = "nvidia/nv-embedqa-e5-v5";
const EXPECTED_DIM = 1024;

let pass = 0;
let fail = 0;

function ok(msg) {
  pass++;
  console.log(`  ok    ${msg}`);
}
function bad(msg, err) {
  fail++;
  console.log(`  FAIL  ${msg}`);
  if (err) console.log(`        ${err.message ?? err}`);
}

async function checkNvidia() {
  console.log("\nNVIDIA NIM (integrate.api.nvidia.com)");
  if (!process.env.NVIDIA_API_KEY) {
    bad("NVIDIA_API_KEY not set in env or .env.local");
    return;
  }
  const client = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: NVIDIA_BASE_URL,
  });

  // Chat smoke test.
  try {
    const t0 = Date.now();
    const resp = await client.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: "Reply with the single word: pong." },
        { role: "user", content: "ping" },
      ],
      temperature: 0,
      max_tokens: 8,
    });
    const text = resp.choices?.[0]?.message?.content?.trim() ?? "";
    const ms = Date.now() - t0;
    if (text.toLowerCase().includes("pong")) {
      ok(`chat ${CHAT_MODEL} responded "${text}" in ${ms} ms`);
    } else {
      bad(`chat ${CHAT_MODEL} returned unexpected text: "${text}"`);
    }
  } catch (e) {
    bad(`chat ${CHAT_MODEL} call failed`, e);
  }

  // Embedding smoke test.
  try {
    const t0 = Date.now();
    const resp = await client.embeddings.create({
      model: EMBED_MODEL,
      input: ["two bed brownstone in Park Slope near the F train"],
      // NVIDIA embedding endpoints accept input_type for asymmetric retrieval.
      // SDK passes through unknown fields. If it errors, drop this line.
      input_type: "query",
    });
    const vec = resp.data?.[0]?.embedding;
    const ms = Date.now() - t0;
    if (Array.isArray(vec) && vec.length === EXPECTED_DIM) {
      ok(`embed ${EMBED_MODEL} returned ${vec.length}-dim vector in ${ms} ms`);
    } else {
      bad(
        `embed ${EMBED_MODEL} returned unexpected shape: length=${vec?.length}`,
      );
    }
  } catch (e) {
    bad(`embed ${EMBED_MODEL} call failed`, e);
  }
}

async function checkOpenAI() {
  console.log("\nOpenAI (api.openai.com)");
  if (!process.env.OPENAI_API_KEY) {
    console.log(
      "  skip  OPENAI_API_KEY not set. Required only for Phase 5 voice.",
    );
    return;
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const t0 = Date.now();
    const resp = await client.models.list();
    const ms = Date.now() - t0;
    const hasRealtime = resp.data.some((m) => m.id.includes("realtime"));
    if (hasRealtime) {
      ok(`models.list returned ${resp.data.length} models in ${ms} ms (Realtime model present)`);
    } else {
      ok(`models.list returned ${resp.data.length} models in ${ms} ms`);
      console.log("  note  no Realtime model in account; voice may need access");
    }
  } catch (e) {
    bad("models.list failed", e);
  }
}

await checkNvidia();
await checkOpenAI();

console.log(`\nSummary: ${pass} ok, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
