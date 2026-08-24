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
import { isFunction, isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";

const { randomUUID } = require("crypto");
const { MAX_SESSION_ITEMS } = require("../../src/shared/utils/realtimeConfig");

// Allowed Realtime modalities for this bridge. `audio` is a recognized protocol
// value (so session.update accepts it and response.create can refuse it with a
// clear error) but is never actually synthesized.
const ALLOWED_MODALITIES = new Set(["text", "audio"]);
const ALLOWED_ROLES = new Set(["user", "assistant", "system"]);

// Realtime scalar ranges (OpenAI Realtime protocol). Values outside are
// rejected at session.update rather than forwarded upstream where they'd 400
// with a less actionable message. `max_output_tokens` also accepts the literal
// string "inf" on the wire, but this bridge requires finite integers per spec.
const TEMP_MIN = 0.6;
const TEMP_MAX = 1.2;
const MAX_OUTPUT_TOKENS_MIN = 1;
const MAX_OUTPUT_TOKENS_MAX = 4096;

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
    ...(session.temperature != null ? { temperature: session.temperature } : null),
    ...(session.maxOutputTokens != null ? { max_tokens: session.maxOutputTokens } : null)
  };
}

function send(ws, event) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

function sendError(ws, message, { type = "invalid_request_error", code = null, eventId = null } = {}) {
  send(ws, {
    type: "error",
    event_id: eventId || `evt_${randomUUID()}`,
    error: { type, code, message }
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
function createRealtimeSession({ ws, session, chat, headers = {}, maxItems = MAX_SESSION_ITEMS }) {
  if (!isFunction(chat)) throw new Error("createRealtimeSession requires an injected chat() dispatcher");

  let inFlight = null; // AbortController for the active response

  /**
   * Enforce the session.items cap while NEVER evicting system items (they carry
   * instructions). Drops the oldest non-system items until the length is at or
   * below `maxItems`, or until only system items remain. Returns `true` if the
   * list is now within the cap, `false` if it could not be brought under the
   * cap because only system items are left (caller must reject the growth).
   *
   * Called after EVERY mutation that grows `session.items` — client
   * `conversation.item.create` AND the assistant turn appended at the end of
   * `response.create` — so a run of back-to-back responses cannot drift past
   * the cap. The assistant-turn path always has the triggering user item as a
   * non-system eviction candidate, so it never hits the `false` branch in
   * practice; the guard exists for client-driven growth.
   */
  function trimSessionItems() {
    const cap = Number.isFinite(maxItems) && maxItems > 0 ? maxItems : MAX_SESSION_ITEMS;
    while (session.items.length > cap) {
      const idx = session.items.findIndex((it) => it.role !== "system");
      if (idx === -1) return false; // only system items remain; cannot evict further
      session.items.splice(idx, 1);
    }
    return true;
  }

  /**
   * Abort any in-flight upstream response. Idempotent: safe to call from both
   * the `close` and `error` ws handlers, and more than once. The abort surfaces
   * inside `runResponseCreate` as an `AbortError`, mapped to a `response.done`
   * with status `"cancelled"`. We deliberately do NOT null `inFlight` here: the
   * owning `runResponseCreate` clears it in its `finally` (guarded by identity)
   * so an abort racing a newer `response.create` can never clobber the newer
   * request's controller.
   */
  function dispose() {
    if (inFlight) {
      try {inFlight.abort();} catch {/* ignore */}
    }
  }

  /**
   * Validate the known fields of a `session.update` payload WITHOUT mutating
   * the session. Unknown fields are accepted and ignored (not stored) — we only
   * police the fields we understand. Returns `{ patch }` on success, where
   * `patch` contains only the validated, coercible known fields; or `{ error }`
   * on the first invalid known field. Atomicity lives in the caller: nothing is
   * applied unless every supplied known field validates.
   *
   * Field PRESENCE is detected with hasOwnProperty (not `!= null`) so an
   * explicit JSON `null` — e.g. `"temperature": null` over the wire — is
   * rejected as wrong-type rather than silently treated as "not supplied".
   */
  function validateSessionUpdate(s) {
    const has = (k) => Object.prototype.hasOwnProperty.call(s, k);
    const patch = {};
    if (has("model")) {
      if (!isString(s.model)) return { error: "session.model must be a string" };
      patch.model = s.model;
    }
    if (has("instructions")) {
      if (!isString(s.instructions)) return { error: "session.instructions must be a string" };
      patch.instructions = s.instructions;
    }
    if (has("modalities")) {
      if (!Array.isArray(s.modalities) || !s.modalities.every((m) => isString(m) && ALLOWED_MODALITIES.has(m))) {
        return { error: "session.modalities must be an array of: text, audio" };
      }
      patch.modalities = s.modalities.slice();
    }
    if (has("temperature")) {
      if (!isNumber(s.temperature) || !Number.isFinite(s.temperature) || s.temperature < TEMP_MIN || s.temperature > TEMP_MAX) {
        return { error: `session.temperature must be a finite number in [${TEMP_MIN}, ${TEMP_MAX}]` };
      }
      patch.temperature = s.temperature;
    }
    if (has("max_output_tokens")) {
      if (
      !isNumber(s.max_output_tokens) ||
      !Number.isFinite(s.max_output_tokens) ||
      !Number.isInteger(s.max_output_tokens) ||
      s.max_output_tokens < MAX_OUTPUT_TOKENS_MIN ||
      s.max_output_tokens > MAX_OUTPUT_TOKENS_MAX)
      {
        return { error: `session.max_output_tokens must be an integer in [${MAX_OUTPUT_TOKENS_MIN}, ${MAX_OUTPUT_TOKENS_MAX}]` };
      }
      patch.maxOutputTokens = s.max_output_tokens;
    }
    return { patch };
  }

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
        try {const j = await res.json();msg = j?.error?.message || msg;} catch {/* ignore */}
        sendError(ws, msg, { type: status >= 500 ? "server_error" : "invalid_request_error" });
        send(ws, { type: "response.done", event_id: `evt_${randomUUID()}`, response: { id: responseId, status: "failed" } });
        return;
      }

      const contentType = res.headers?.get?.("content-type") || "";
      if (contentType.includes("text/event-stream") && res.body) {
        for await (const chunk of iterateSSE(res.body)) {
          if (chunk.data === "[DONE]") break;
          let json;
          try {json = JSON.parse(chunk.data);} catch {continue;}
          const choice = json.choices?.[0];
          const delta = choice?.delta?.content;
          if (isString(delta) && delta.length) {
            accumulated += delta;
            send(ws, {
              type: "response.output_text.delta",
              event_id: `evt_${randomUUID()}`,
              response_id: responseId,
              item_id: itemId,
              output_index: 0,
              content_index: 0,
              delta
            });
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (json.usage) usage = json.usage;
        }
      } else {
        // Non-streaming JSON fallback (provider forced non-stream upstream).
        let json = null;
        try {json = await res.json();} catch {json = null;}
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
            delta: text
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
        text: accumulated
      });

      // Persist assistant turn into the session conversation so subsequent
      // response.create calls see it, then enforce the item cap (a run of
      // back-to-back responses otherwise grows history unboundedly). The
      // triggering user item is always present as a non-system eviction
      // candidate, so trimming here cannot strand this assistant turn.
      session.items.push({ id: itemId, type: "message", role: "assistant", content: accumulated });
      trimSessionItems();

      send(ws, {
        type: "response.done",
        event_id: `evt_${randomUUID()}`,
        response: {
          id: responseId,
          status: "completed",
          output: [{ id: itemId, type: "message", role: "assistant", content: [{ type: "output_text", text: accumulated }] }],
          ...(usage ? { usage: mapUsage(usage) } : null),
          finish_reason: finishReason
        }
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        send(ws, { type: "response.done", event_id: `evt_${randomUUID()}`, response: { id: responseId, status: "cancelled" } });
      } else {
        sendError(ws, error?.message || "internal error", { type: "server_error" });
        send(ws, { type: "response.done", event_id: `evt_${randomUUID()}`, response: { id: responseId, status: "failed" } });
      }
    } finally {
      // Only release the handle if WE are still the active request. A cancel/
      // close may have aborted us and a newer response.create may already hold
      // a fresh controller — clearing unconditionally would drop that newer
      // request's abort handle and defeat dispose() on a later close.
      if (inFlight === controller) inFlight = null;
    }
  }

  async function handleClientEvent(raw) {
    let event;
    try {
      event = JSON.parse(isString(raw) ? raw : raw.toString("utf8"));
    } catch {
      sendError(ws, "invalid JSON event");
      return;
    }
    const type = event?.type;
    switch (type) {
      case "session.update":{
          // `session`, when PRESENT, must be a non-null, non-array object. Use
          // hasOwnProperty so an explicit `session: null` is rejected (a bare
          // `!= null` check would let it through as a no-op `{}`). An omitted
          // `session` key remains a valid no-op update → emits `session.updated`.
          const hasSession = Object.prototype.hasOwnProperty.call(event, "session");
          if (hasSession && (event.session === null || !isObject(event.session) || Array.isArray(event.session))) {
            sendError(ws, "session.update session must be an object", { type: "invalid_request_error", code: "invalid_session_update", eventId: event.event_id || null });
            break;
          }
          const s = event.session || {};
          // Validate ALL known fields before mutating anything. Unknown keys in
          // `s` are accepted and ignored (not stored). On any invalid known
          // field: emit error, apply NOTHING, send no `session.updated`.
          const { patch, error } = validateSessionUpdate(s);
          if (error) {
            sendError(ws, error, { type: "invalid_request_error", code: "invalid_session_update", eventId: event.event_id || null });
            break;
          }
          if (patch.model != null) session.model = patch.model;
          if (patch.instructions != null) session.instructions = patch.instructions;
          if (patch.modalities != null) session.modalities = patch.modalities;
          if (patch.temperature != null) session.temperature = patch.temperature;
          if (patch.maxOutputTokens != null) session.maxOutputTokens = patch.maxOutputTokens;
          send(ws, { type: "session.updated", event_id: `evt_${randomUUID()}`, session: publicSession(session) });
          break;
        }
      case "conversation.item.create":{
          // `item`, when PRESENT, must be a non-null, non-array object. A
          // malformed shape (null / array / string) must not be coerced into a
          // default `{role:"user"}` message — reject at the trust boundary.
          const hasItem = Object.prototype.hasOwnProperty.call(event, "item");
          if (hasItem && (event.item === null || !isObject(event.item) || Array.isArray(event.item))) {
            sendError(ws, "conversation.item.create item must be an object", { type: "invalid_request_error", code: "invalid_item", eventId: event.event_id || null });
            break;
          }
          const item = event.item || {};
          // Validate only known fields; unknown fields (future protocol
          // extensions — e.g. function/tool call items that carry no `role`) are
          // accepted and ignored, NOT preserved on the stored/emitted item.
          // `role` defaults to "user" when the KEY is absent; an explicit
          // `role: null` (JSON null over the wire) or any non-string / out-of-set
          // value is rejected. Presence is detected with hasOwnProperty so null is
          // not mistaken for "not supplied".
          const hasRole = Object.prototype.hasOwnProperty.call(item, "role");
          if (hasRole && (!isString(item.role) || !ALLOWED_ROLES.has(item.role))) {
            sendError(ws, "item.role must be one of: user, assistant, system", { type: "invalid_request_error", code: "invalid_item_role", eventId: event.event_id || null });
            break;
          }
          const stored = {
            id: item.id || `item_${randomUUID()}`,
            type: item.type || "message",
            role: hasRole ? item.role : "user",
            content: flattenContent(item.content)
          };
          // Preflight: if the history is already at the cap and EVERY existing
          // item is a system item, there is nothing evictable (system items are
          // never dropped) — any push would either overflow or immediately evict
          // the very item we just added. Reject before mutating state, regardless
          // of the new item's role. No `conversation.item.created` is emitted.
          const cap = Number.isFinite(maxItems) && maxItems > 0 ? maxItems : MAX_SESSION_ITEMS;
          if (session.items.length >= cap && session.items.every((it) => it.role === "system")) {
            sendError(ws, `session item limit (${cap}) reached`, { type: "invalid_request_error", code: "session_item_limit", eventId: event.event_id || null });
            break;
          }
          session.items.push(stored);
          trimSessionItems();
          send(ws, { type: "conversation.item.created", event_id: `evt_${randomUUID()}`, item: stored });
          break;
        }
      case "response.create":{
          if (inFlight) sendError(ws, "a response is already in progress", { type: "invalid_request_error", code: "response_in_progress" });else
          await runResponseCreate();
          break;
        }
      case "response.cancel":{
          dispose();
          break;
        }
      default:
        sendError(ws, `unsupported event type: ${type}`, { type: "invalid_request_error", code: "unsupported_event" });
    }
  }

  return { session, handleClientEvent, dispose };
}

function flattenContent(content) {
  if (content == null) return "";
  if (isString(content)) return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (isString(part)) return part;
      if (part && isObject(part)) return part.text ?? part.input_text ?? "";
      return "";
    }).join("");
  }
  if (isObject(content)) return content.text ?? content.input_text ?? "";
  return String(content);
}

function mapUsage(u) {
  return {
    input_tokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    output_tokens: u.completion_tokens ?? u.output_tokens ?? 0,
    total_tokens: u.total_tokens ?? (u.prompt_tokens || 0) + (u.completion_tokens || 0)
  };
}

function publicSession(s) {
  return {
    id: s.id,
    model: s.model,
    instructions: s.instructions,
    modalities: s.modalities,
    temperature: s.temperature,
    max_output_tokens: s.maxOutputTokens
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
    try {reader.releaseLock();} catch {/* ignore */}
  }
}

module.exports = {
  buildChatBody,
  createRealtimeSession,
  flattenContent,
  iterateSSE,
  mapUsage,
  publicSession,
  sendError
};