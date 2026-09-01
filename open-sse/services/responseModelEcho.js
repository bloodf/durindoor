/**
 * Client-visible response model identity compatibility.
 *
 * Codex Responses payloads echo effort-qualified client IDs in lifecycle SSE
 * and unary JSON. Anthropic streaming payloads echo the exact original Claude
 * Code selection in `message_start.message.model`, independent of combo or
 * provider routing. Both rewrites happen only at the common response boundary;
 * provider dispatch, limits, usage, logs, and diagnostics keep routed identity.
 */

import { extractCompleteSseFrames } from "../utils/streamHelpers.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const RESPONSES_LIFECYCLE_EVENTS = new Set([
"response.created",
"response.in_progress",
"response.completed"]
);

/**
 * Rewrite a complete Responses SSE frame's lifecycle-event `response.model`
 * to `echoModel`. Matches upstream `echoModelInSseLine`: the event identity is
 * read from the JSON payload's own `type` field, NOT from an optional `event:`
 * header line — Codex Responses lifecycle frames are data-only (`data: {...}`
 * with `"type": "response.created"` inside). Returns the frame unchanged
 * (byte-for-byte) unless a lifecycle payload was rewritten; a rewritten frame
 * is re-serialized with its own detected line ending. Only the three lifecycle
 * events are touched — arbitrary nested `response.model` on other event shapes
 * is left alone.
 *
 * @param {string} frame One complete SSE frame (no trailing delimiter).
 * @param {string} echoModel Client-requested model id to echo.
 * @returns {string} The original or rewritten frame.
 */
function rewriteResponsesSseFrame(frame, echoModel) {
  if (!frame.includes("data:")) return frame;
  const eol = frame.includes("\r\n") ? "\r\n" : "\n";
  let changed = false;
  const lines = frame.split(/\r?\n/).map((line) => {
    if (!line.startsWith("data:")) return line;
    let value = line.slice(5);
    if (value.startsWith(" ")) value = value.slice(1);
    if (value === "[DONE]") return line;
    try {
      const parsed = JSON.parse(value);
      // Lifecycle identity comes from the payload `type`, so data-only frames
      // (no `event:` header) are rewritten exactly like annotated ones.
      if (!RESPONSES_LIFECYCLE_EVENTS.has(parsed?.type)) return line;
      const nested = parsed?.response;
      if (nested && isObject(nested) && !Array.isArray(nested)) {
        nested.model = echoModel;
        changed = true;
        return `data: ${JSON.stringify(parsed)}`;
      }
    } catch {/* unparseable payloads pass through unchanged */}
    return line;
  });
  return changed ? lines.join(eol) : frame;
}

/**
 * Build a TransformStream that echoes the client-requested model id into
 * Responses lifecycle SSE frames. Frame-accurate: buffers raw text across
 * chunk boundaries and only touches complete frames, so multi-byte JSON never
 * splits mid-token. Non-lifecycle frames pass through byte-for-byte.
 *
 * @param {string} echoModel Client-requested model id to echo.
 * @returns {TransformStream}
 */
export function createResponsesModelEchoStream(echoModel) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new TransformStream({
    transform(chunk, controller) {
      buffer += isString(chunk) ? chunk : decoder.decode(chunk, { stream: true });
      const batch = extractCompleteSseFrames(buffer);
      buffer = batch.remainder;
      for (const frame of batch.frames) {
        const rewritten = rewriteResponsesSseFrame(frame, echoModel);
        // Frames carry no delimiter (stripped by extraction); infer the
        // stream's delimiter style from the frame's own line endings.
        const delimiter = frame.includes("\r\n") ? "\r\n\r\n" : "\n\n";
        controller.enqueue(encoder.encode(`${rewritten}${delimiter}`));
      }
    },
    flush(controller) {
      // Flush any trailing partial frame (unterminated tail) verbatim.
      buffer += decoder.decode();
      if (buffer) {
        controller.enqueue(encoder.encode(rewriteResponsesSseFrame(buffer, echoModel)));
        buffer = "";
      }
    }
  });
}

function rewriteClaudeSseFrame(frame, echoModel) {
  if (!frame.includes("message_start") || !frame.includes("data:")) return frame;
  const eol = frame.includes("\r\n") ? "\r\n" : "\n";
  let changed = false;
  const lines = frame.split(/\r?\n/).map((line) => {
    if (!line.startsWith("data:")) return line;
    let value = line.slice(5);
    if (value.startsWith(" ")) value = value.slice(1);
    try {
      const parsed = JSON.parse(value);
      if (parsed?.type !== "message_start" || !isObject(parsed.message) || Array.isArray(parsed.message)) return line;
      parsed.message.model = echoModel;
      changed = true;
      return `data: ${JSON.stringify(parsed)}`;
    } catch {
      return line;
    }
  });
  return changed ? lines.join(eol) : frame;
}

export function createClaudeModelEchoStream(echoModel) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += isString(chunk) ? chunk : decoder.decode(chunk, { stream: true });
      const batch = extractCompleteSseFrames(buffer);
      buffer = batch.remainder;
      for (const frame of batch.frames) {
        const delimiter = frame.includes("\r\n") ? "\r\n\r\n" : "\n\n";
        controller.enqueue(encoder.encode(`${rewriteClaudeSseFrame(frame, echoModel)}${delimiter}`));
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) controller.enqueue(encoder.encode(rewriteClaudeSseFrame(buffer, echoModel)));
    },
  });
}

export function applyClaudeResponseModelEcho(result, echoModel) {
  if (!echoModel || !result || result.success === false || !result.response?.body) return result;
  const headers = new Headers(result.response.headers);
  if (!(headers.get("content-type") || "").toLowerCase().includes("text/event-stream")) return result;
  headers.delete("content-length");
  return {
    ...result,
    response: new Response(result.response.body.pipeThrough(createClaudeModelEchoStream(echoModel)), {
      status: result.response.status,
      statusText: result.response.statusText,
      headers,
    }),
  };
}

export function resolveClaudeEchoModel(clientRawRequest) {
  const original = clientRawRequest?.originalModel;
  return isString(original) && original ? original : null;
}

/**
 * Apply the Codex Responses model echo to a handler result's `Response`.
 * Boundary wrapper used by chatCore across its three terminal handlers
 * (forced-SSE→JSON, non-stream, stream), so every live branch is covered
 * independent of provider/combo routing.
 *
 *  - JSON bodies (`application/json`): parsed, top-level `model` set to
 *    `echoModel` (added when the converter omitted it), re-serialized.
 *  - SSE bodies (`text/event-stream`): piped through the lifecycle echo
 *    transform.
 *
 * Rewriting changes the byte length, so `content-length` is dropped. The
 * result is returned unchanged when there is nothing to echo or the body is
 * absent.
 *
 * @param {{success?: boolean, response: Response}|null|undefined} result
 * @param {string|null|undefined} echoModel Client-requested model id.
 * @returns {Promise<typeof result>}
 */
export async function applyResponseModelEcho(result, echoModel) {
  if (!echoModel || !result || result.success === false || !result.response?.body) return result;
  const headers = new Headers(result.response.headers);
  const contentType = (headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    // Read failure (transport error) must propagate to chatCore's error
    // handling — never be folded into an empty body. Only the JSON.parse is
    // guarded.
    const bodyText = await result.response.text();
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      // Unparseable JSON — return the original body untouched.
      return { ...result, response: new Response(bodyText, {
          status: result.response.status,
          statusText: result.response.statusText,
          headers
        }) };
    }
    // Only touch real Responses payloads (`object: "response"`) or bodies
    // that already carry a string `model`. Other JSON (e.g. an error object
    // returned with success:true) is left byte-for-byte identical — upstream
    // rewrites only existing model fields, never invents one.
    const isResponsesObject = parsed?.object === "response";
    const hasStringModel = isString(parsed?.model);
    if (
    parsed && isObject(parsed) && !Array.isArray(parsed) && (
    isResponsesObject || hasStringModel))
    {
      parsed.model = echoModel;
      headers.delete("content-length");
      return {
        ...result,
        response: new Response(JSON.stringify(parsed), {
          status: result.response.status,
          statusText: result.response.statusText,
          headers
        })
      };
    }
    // Not a Responses payload — return the body untouched.
    return { ...result, response: new Response(bodyText, {
        status: result.response.status,
        statusText: result.response.statusText,
        headers
      }) };
  }

  if (contentType.includes("text/event-stream")) {
    headers.delete("content-length");
    return {
      ...result,
      response: new Response(
        result.response.body.pipeThrough(createResponsesModelEchoStream(echoModel)),
        {
          status: result.response.status,
          statusText: result.response.statusText,
          headers
        }
      )
    };
  }

  return result;
}

/**
 * Compute the model id to echo for a Codex-CLI-originated Responses request.
 * Source of truth is the ORIGINAL client body model (`clientRawRequest.body.model`)
 * — in combos `modelInfo.model` is the routed upstream id, which must never be
 * echoed. No fallback to the route-resolved model: when the raw client body
 * model is absent there is nothing safe to echo (echoing a routed upstream id
 * would misreport the model the CLI asked for). Any non-empty requested model
 * echoes (no effort-suffix gate): the Codex CLI reflects whatever it asked for.
 *
 * @param {object|null|undefined} clientRawRequest Raw client request bag.
 * @returns {string|null}
 */
export function resolveResponsesEchoModel(clientRawRequest) {
  const fromBody = clientRawRequest?.body?.model;
  if (isString(fromBody) && fromBody) return fromBody;
  return null;
}