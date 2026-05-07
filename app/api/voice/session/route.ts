// POST /api/voice/session
//
// Mints an ephemeral session token for the OpenAI Realtime API. The browser
// uses that token (NOT the project-level OPENAI_API_KEY) to establish a
// WebRTC connection directly with OpenAI.
//
// We configure the session here with our system prompt and two tools:
// search_listings and get_neighborhood_brief. Both call back into our own
// Next.js routes (/api/search and /api/research/quick) once the model
// invokes them. The browser handles that round-trip.
//
// Reference: https://platform.openai.com/docs/api-reference/realtime-sessions
//
// Example:
//   curl -X POST https://home-finder-claw.vercel.app/api/voice/session
//   -> { "client_secret": { "value": "ek_...", "expires_at": 1234567890 }, ... }

import { NextResponse } from "next/server";
import { envPresence, requireEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17";

const SYSTEM_PROMPT = `You are a New York real estate assistant. The user will speak. Be concise.

Workflow:
1. When the user describes what they want, call search_listings with their natural query as a single string.
2. When the user asks about a specific neighborhood or listing, call get_neighborhood_brief with the listing_id from the most recent search results.
3. Read back results in two sentences max. Offer to continue.
4. If the user asks about people or demographics, redirect: "I can help with property features, transit, schools, and prices. What would you like to know?"

Important:
- Speak naturally and concisely. Keep responses under 30 words unless asked to elaborate.
- After a search, mention the count and the top 1-2 examples. Do not list everything.
- Never make up listings or prices. If a tool returns no results, say so.`;

export async function POST() {
  const presence = envPresence(["OPENAI_API_KEY"]);
  if (!presence.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not set. Voice mode requires an OpenAI key for the Realtime API. Set it in .env.local for local dev or in the Vercel project settings.",
      },
      { status: 503 },
    );
  }
  const { OPENAI_API_KEY } = requireEnv(["OPENAI_API_KEY"]);

  try {
    const resp = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: REALTIME_MODEL,
        voice: "alloy",
        instructions: SYSTEM_PROMPT,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: { type: "server_vad" },
        tools: [
          {
            type: "function",
            name: "search_listings",
            description:
              "Search New York City real estate listings using a natural language query. Returns a list of matching listings with price, beds, baths, address, and nearest subway.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description:
                    "The user's request as a single sentence in natural English, e.g. 'two bed in Brooklyn under 1M near the F train'.",
                },
              },
              required: ["query"],
            },
          },
          {
            type: "function",
            name: "get_neighborhood_brief",
            description:
              "Get a brief about the neighborhood of a specific listing. Returns ZHVI price trend, 311 noise/rodent complaint counts, and nearest subway info.",
            parameters: {
              type: "object",
              properties: {
                listing_id: {
                  type: "string",
                  description:
                    "The listing_id of a specific listing returned by a previous search_listings call.",
                },
              },
              required: ["listing_id"],
            },
          },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { error: `OpenAI Realtime session creation failed: ${text}` },
        { status: resp.status },
      );
    }

    const data = (await resp.json()) as {
      id: string;
      client_secret: { value: string; expires_at: number };
    };
    return NextResponse.json({
      session_id: data.id,
      client_secret: data.client_secret,
      model: REALTIME_MODEL,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Voice session error: ${message}` },
      { status: 500 },
    );
  }
}
