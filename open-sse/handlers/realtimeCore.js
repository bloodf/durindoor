/**
 * OpenAI-Realtime-shaped session core (text modality).
 *
 * Protocol-only. This module knows how to speak the Realtime event dialect on
 * an established `ws` connection; it deliberately does NOT resolve models,
 * enforce API-key policy, refresh provider credentials, or pick accounts. That
 * full pipeline already lives in the HTTP chat handler
 * (`src/sse/handlers/chat.js` → `open-sse/handlers/chatCore.js`), so each
 * `response.create` is turned into an ordinary OpenAI chat-completions request
 * and dispatched through the injected `chat` callback — by default a loopback
 * `fetch` to `/api/v1/chat/completions`, which reuses the entire production
 * path unchanged. The SSE stream that comes back is then re-framed into
 * Realtime `response.output_text.delta` / `response.done` events.
 *
 * Plain-Node safe at import time (CommonJS only, no `@/` / `open-sse/` aliases,
 * no ESM-only syntax) so it can be `require`d by `custom-server.js` and by the
 * bundled `.next/standalone/custom-server.js` after `scripts/build-app.mjs`
 * copies it into the standalone root.
 */

"use strict";

const { randomUUID } = require("crypto");

/** Default OpenAI chat completion body built from a realtime session + user turn. */
function buildChatBody(session) {
  const messages = [];
  if (session.instructions) messages.push({ role: "system", content: session.instructions });
  for (const item of session.items) {
    if (item.type === "message" && item.role && item.content != null) {
      messages.push({ role: item.role, content: item.content });
    }
  }
  return {
    model: session.model,
    messages,
    stream: true,
    ...(session.temperature != null ? { temperature: session.temperature } : {}),
    ...(session.maxOutputTokens != null ? { max_tokens: session.maxOutputTokens } : {}),
  };
}

function send(ws, event) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

function sendError(ws, message, { type = "invalid_request_error", code = null, eventId = null } = {}) {
  send(ws, {
    type: "error",
    event_id: eventId || `evt_${randomUUID()}`,
    error: { type, code, message },
  });
}

/**
 * Drive one Realtime WebSocket session.
 *
 * @param {object} opts
 * @param {import("ws").WebSocket} opts.ws
 * @param {object} opts.session - { model, instructions, temperature, maxOutputTokens, modalities, items }
 * @param {(args: { body: object, headers: object, signal?: AbortSignal }) => Promise<Response>} opts.chat
 *        injectable chat dispatcher returning a Web `Response` (SSE when streaming, JSON otherwise).
 * @param {object} [opts.headers] - headers forwarded to chat (must include Authorization for policy enforcement)
 * @returns {{ session: object, handleClientEvent: (raw: string|Buffer) => Promise<void> }}
 */
function createRealtimeSession({ ws, session, chat, headers = {} }) {
  if (typeof chat !== "function") throw new Error("createRealtimeSession requires an injected chat() dispatcher");

  let inFlight = null; // AbortController for the active response

  async function runResponseCreate() {
    const modalities = session.modalities || ["text"];
    if (modalities.includes("audio")) {
      // Honest non-goal: audio modality is not bridged. Refuse explicitly rather
      // than faking audio frames.
      sendError(ws, "audio modality not supported", { type: "invalid_request_error", code: "modality_not_supported" });
      return;
    }

    const hasUserTurn = session.items.some((it) => it.type === "message" && it.role === "user");
    if (!hasUserTurn) {
      sendError(ws, "response.create requires at least one user conversation item", { type: "invalid_request_error", code: "missing_user_turn" });
      return;
    }

    const body = buildChatBody(session);

    const responseId = `resp_${randomUUID()}`;
    const itemId = `item_${randomUUID()}`;
    send(ws, { type: "response.created", event_id: `evt_${randomUUID()}`, response: { id: responseId, status: "in_progress" } });

    const controller = new AbortController();
    inFlight = controller;
    let accumulated = "";
    let finishReason = null;
    let usage = null;

    try {
      const res = await chat({ body, headers, signal: controller.signal });
      if (!res || !res.ok) {
        const status = res ? res.status : 502;
        let msg = "upstream chat request failed";
        try { const j = await res.json(); msg = j?.error?.message || msg; } catch { /* ignore */ }
        sendError(ws, msg, { type: status >= 500 ? "server_error" : "invalid_request_error" });
        send(ws, { type: "response.done", event_id: `evt_${randomUUID()}`, response: { id: responseId, status: "failed" } });
        return;
      }

      const contentType = res.headers?.get?.("content-type") || "";
      if (contentType.includes("text/event-stream") && res.body) {
        for await (const chunk of iterateSSE(res.body)) {
          if (chunk.data === "[DONE]") break;
          let json;
          try { json = JSON.parse(chunk.data); } catch { continue; }
          const choice = json.choices?.[0];
          const delta = choice?.delta?.content;
          if (typeof delta === "string" && delta.length) {
            accumulated += delta;
            send(ws, {
              type: "response.output_text.delta",
              event_id: `evt_${randomUUID()}`,
              response_id: responseId,
              item_id: itemId,
              output_index: 0,
              content_index: 0,
              delta,
            });
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (json.usage) usage = json.usage;
        }
      } else {
        // Non-streaming JSON fallback (provider forced non-stream upstream).
        let json = null;
        try { json = await res.json(); } catch { json = null; }
        const text = json?.choices?.[0]?.message?.content || "";
        if (text) {
          accumulated = text;
          send(ws, {
            type: "response.output_text.delta",
            event_id: `evt_${randomUUID()}`,
            response_id: responseId,
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            delta: text,
          });
        }
        finishReason = json?.choices?.[0]?.finish_reason || "stop";
        usage = json?.usage || null;
      }

      send(ws, {
        type: "response.output_text.done",
        event_id: `evt_${randomUUID()}`,
        response_id: responseId,
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        text: accumulated,
      });

      // Persist assistant turn into the session conversation so subsequent
      // response.create calls see it.
      session.items.push({ id: itemId, type: "message", role: "assistant", content: accumulated });

      send(ws, {
        type: "response.done",
        event_id: `evt_${randomUUID()}`,
        response: {
          id: responseId,
          status: "completed",
          output: [{ id: itemId, type: "message", role: "assistant", content: [{ type: "output_text", text: accumulated }] }],
          ...(usage ? { usage: mapUsage(usage) } : {}),
          finish_reason: finishReason,
        },
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        send(ws, { type: "response.done", event_id: `evt_${randomUUID()}`, response: { id: responseId, status: "cancelled" } });
      } else {
        sendError(ws, error?.message || "internal error", { type: "server_error" });
        send(ws, { type: "response.done", event_id: `evt_${randomUUID()}`, response: { id: responseId, status: "failed" } });
      }
    } finally {
      inFlight = null;
    }
  }

  async function handleClientEvent(raw) {
    let event;
    try {
      event = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
    } catch {
      sendError(ws, "invalid JSON event");
      return;
    }
    const type = event?.type;
    switch (type) {
      case "session.update": {
        const s = event.session || {};
        if (typeof s.model === "string") session.model = s.model;
        if (typeof s.instructions === "string") session.instructions = s.instructions;
        if (Array.isArray(s.modalities)) session.modalities = s.modalities;
        if (s.temperature != null) session.temperature = s.temperature;
        if (s.max_output_tokens != null) session.maxOutputTokens = s.max_output_tokens;
        send(ws, { type: "session.updated", event_id: `evt_${randomUUID()}`, session: publicSession(session) });
        break;
      }
      case "conversation.item.create": {
        const item = event.item || {};
        const stored = {
          id: item.id || `item_${randomUUID()}`,
          type: item.type || "message",
          role: item.role || "user",
          content: flattenContent(item.content),
        };
        session.items.push(stored);
        send(ws, { type: "conversation.item.created", event_id: `evt_${randomUUID()}`, item: stored });
        break;
      }
      case "response.create": {
        if (inFlight) sendError(ws, "a response is already in progress", { type: "invalid_request_error", code: "response_in_progress" });
        else await runResponseCreate();
        break;
      }
      case "response.cancel": {
        if (inFlight) { try { inFlight.abort(); } catch { /* ignore */ } }
        break;
      }
      default:
        sendError(ws, `unsupported event type: ${type}`, { type: "invalid_request_error", code: "unsupported_event" });
    }
  }

  return { session, handleClientEvent };
}

function flattenContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") return part.text ?? part.input_text ?? "";
      return "";
    }).join("");
  }
  if (typeof content === "object") return content.text ?? content.input_text ?? "";
  return String(content);
}

function mapUsage(u) {
  return {
    input_tokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    output_tokens: u.completion_tokens ?? u.output_tokens ?? 0,
    total_tokens: u.total_tokens ?? ((u.prompt_tokens || 0) + (u.completion_tokens || 0)),
  };
}

function publicSession(s) {
  return {
    id: s.id,
    model: s.model,
    instructions: s.instructions,
    modalities: s.modalities,
    temperature: s.temperature,
    max_output_tokens: s.maxOutputTokens,
  };
}

/**
 * Async generator yielding parsed `{ data }` records from a Web ReadableStream
 * of SSE bytes. Handles multi-line data: and event boundaries (\n\n).
 */
async function* iterateSSE(readable) {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = [];
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^\s/, ""));
        }
        if (dataLines.length) yield { data: dataLines.join("\n") };
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

module.exports = {
  buildChatBody,
  createRealtimeSession,
  flattenContent,
  iterateSSE,
  mapUsage,
  publicSession,
  sendError,
};
