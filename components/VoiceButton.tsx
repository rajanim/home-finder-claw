"use client";

// VoiceButton manages a WebRTC session with the OpenAI Realtime API.
//
// Lifecycle:
//   1. User clicks the mic. We POST /api/voice/session to mint an
//      ephemeral token (this hides the project OPENAI_API_KEY from the
//      browser).
//   2. Create RTCPeerConnection. Add the user's microphone track.
//      Open a data channel for events.
//   3. Send the local SDP offer to OpenAI's Realtime endpoint, set the
//      returned SDP answer.
//   4. Listen on the data channel for response.function_call_arguments.done
//      events. When the model calls search_listings or get_neighborhood_brief,
//      hit our own /api/search or /api/research/quick and send the result
//      back as a function_call_output, then nudge the model to continue
//      with response.create.
//   5. Click again to stop. Close the peer connection, stop the mic.

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2, AudioLines } from "lucide-react";
import type { SearchResponse } from "@/lib/types";

type Phase = "idle" | "connecting" | "live" | "speaking" | "error";

type Props = {
  onSearchResult?: (resp: SearchResponse) => void;
  onTranscript?: (role: "user" | "assistant", text: string) => void;
};

type RealtimeEvent = {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  response?: {
    output?: Array<{
      type: string;
      name?: string;
      call_id?: string;
      arguments?: string;
    }>;
  };
  delta?: string;
  transcript?: string;
};

export function VoiceButton({ onSearchResult, onTranscript }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cleanup = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current = null;
    dcRef.current = null;
    streamRef.current = null;
    setPhase("idle");
    setStatusText("");
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const handleToolCall = useCallback(
    async (call: { name: string; call_id: string; argsJson: string }) => {
      const dc = dcRef.current;
      if (!dc || dc.readyState !== "open") return;
      let output: unknown;
      try {
        const args = JSON.parse(call.argsJson || "{}");
        if (call.name === "search_listings") {
          setStatusText(`Searching: "${String(args.query ?? "").slice(0, 40)}"`);
          const r = await fetch("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: args.query }),
          });
          const data = (await r.json()) as SearchResponse;
          if (onSearchResult) onSearchResult(data);
          // Compact summary for the model. Avoid sending the full listings
          // array (it would blow the context).
          const top = (data.listings ?? []).slice(0, 5).map((l) => ({
            listing_id: l.listing_id,
            price: l.price,
            beds: l.beds,
            baths: l.baths,
            borough: l.borough,
            address: l.address,
            nearest_subway: l.nearest_subway,
          }));
          output = {
            count: data.listings?.length ?? 0,
            refused: data.guard_pre?.ok === false,
            refusal_reason: data.guard_pre?.reason,
            filters: data.intent?.filters,
            top: top,
          };
          setStatusText(`${data.listings?.length ?? 0} results`);
        } else if (call.name === "get_neighborhood_brief") {
          setStatusText("Fetching neighborhood data...");
          const r = await fetch("/api/research/quick", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listing_id: args.listing_id }),
          });
          output = await r.json();
          setStatusText("Brief loaded");
        } else {
          output = { error: `Unknown tool: ${call.name}` };
        }
      } catch (e) {
        output = { error: e instanceof Error ? e.message : String(e) };
      }

      // Send the function output back through the data channel, then ask
      // the model to continue.
      dc.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(output),
          },
        }),
      );
      dc.send(JSON.stringify({ type: "response.create" }));
    },
    [onSearchResult],
  );

  const onDataChannelMessage = useCallback(
    (e: MessageEvent) => {
      let ev: RealtimeEvent;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      switch (ev.type) {
        case "session.created":
        case "session.updated":
          setPhase("live");
          break;
        case "input_audio_buffer.speech_started":
          setStatusText("Listening...");
          setPhase("live");
          break;
        case "input_audio_buffer.speech_stopped":
          setStatusText("Thinking...");
          break;
        case "response.audio.delta":
          // Audio plays via the WebRTC track; nothing to do here.
          break;
        case "response.audio_transcript.delta":
          // could accumulate transcript per response; skip for MVP
          break;
        case "response.audio_transcript.done":
          if (ev.transcript && onTranscript) {
            onTranscript("assistant", ev.transcript);
          }
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (ev.transcript && onTranscript) {
            onTranscript("user", ev.transcript);
          }
          break;
        case "response.function_call_arguments.done": {
          // ev has: name, call_id, arguments
          if (ev.name && ev.call_id) {
            handleToolCall({
              name: ev.name,
              call_id: ev.call_id,
              argsJson: ev.arguments ?? "{}",
            });
          }
          break;
        }
        case "response.created":
          setPhase("speaking");
          break;
        case "response.done":
          setPhase("live");
          setStatusText("Ready. Speak again or stop.");
          break;
        case "error":
          setError(JSON.stringify(ev));
          setPhase("error");
          break;
      }
    },
    [handleToolCall, onTranscript],
  );

  const start = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    setStatusText("Connecting...");
    try {
      // 1. Mint ephemeral key
      const sessResp = await fetch("/api/voice/session", { method: "POST" });
      if (!sessResp.ok) {
        const err = await sessResp.json().catch(() => ({}));
        throw new Error(err.error ?? `session ${sessResp.status}`);
      }
      const sess = (await sessResp.json()) as {
        client_secret: { value: string };
        model: string;
      };

      // 2. Peer connection + microphone
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Inbound audio from the model: route to a hidden audio element.
      const audioEl =
        audioRef.current ??
        Object.assign(new Audio(), { autoplay: true, hidden: true });
      audioRef.current = audioEl;
      pc.ontrack = (ev) => {
        if (ev.streams[0]) audioEl.srcObject = ev.streams[0];
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;
      stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));

      // 3. Data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("message", onDataChannelMessage);

      // 4. SDP offer / answer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResp = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(sess.model)}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${sess.client_secret.value}`,
            "Content-Type": "application/sdp",
          },
        },
      );
      if (!sdpResp.ok) {
        throw new Error(`Realtime SDP exchange failed: ${sdpResp.status}`);
      }
      const answerSdp = await sdpResp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setStatusText("Connected. Speak when ready.");
      setPhase("live");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setPhase("error");
      cleanup();
    }
  }, [cleanup, onDataChannelMessage]);

  const stop = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const active = phase !== "idle" && phase !== "error";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={active ? stop : start}
        aria-label={active ? "End voice session" : "Start voice session"}
        title={active ? "End voice session" : "Talk to the assistant"}
        className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
          phase === "idle" || phase === "error"
            ? "border-border bg-background hover:bg-muted"
            : phase === "connecting"
              ? "border-primary bg-primary/10"
              : phase === "speaking"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-primary bg-primary/15 text-primary animate-pulse"
        }`}
      >
        {phase === "connecting" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : phase === "speaking" ? (
          <AudioLines className="h-4 w-4" />
        ) : active ? (
          <MicOff className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </button>
      {(active || error) && (
        <div
          className={`max-w-[200px] truncate text-right text-[11px] ${
            error ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {error ? error : statusText}
        </div>
      )}
    </div>
  );
}
