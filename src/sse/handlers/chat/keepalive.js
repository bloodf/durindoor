/**
 * Chat entry points that open an early SSE response while provider setup is
 * silent. This is the only place that wraps handleChat in a keepalive.
 */
import { requireJsonContentType } from "open-sse/translator/validate.js";
import { SSE_KEEPALIVE_MS } from "open-sse/config/runtimeConfig.js";
import { ANTHROPIC_PING_FRAME, withEarlyStreamKeepalive } from "open-sse/utils/earlyStreamKeepalive.js";
import { withEarlyJsonKeepalive, resolveJsonKeepaliveThresholdMs } from "open-sse/utils/earlyJsonKeepalive.js";
import { decodeInboundRequest } from "../../utils/inboundGzip.js";
import { handleChat } from "../chat.js";

function chatWithKeepalive(request, streaming, keepalive) {
  const pending = handleChat(request);
  return streaming ? withEarlyStreamKeepalive(pending, { signal: request.signal, ...keepalive }) : pending;
}

/**
 * POST /v1/messages - Claude format (auto convert via handleChat).
 * Streaming requests emit Anthropic ping events while provider setup is silent.
 */
export async function handleMessages(request) {
  // #6414: reject non-JSON Content-Type with 415 before touching the body.
  const ctRejection = requireJsonContentType(request);
  if (ctRejection) return ctRejection;

  const decoded = await decodeInboundRequest(request, { abortedStatus: 499 });
  if (decoded.response) return decoded.response;
  request = decoded.request;

  const body = await request.clone().json().catch(() => null);
  if (body === null) {
    return Response.json({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON body" } }, { status: 400 });
  }

  if (body?.stream !== true) {
    return withEarlyJsonKeepalive(handleChat(request), { thresholdMs: resolveJsonKeepaliveThresholdMs() });
  }

  return chatWithKeepalive(request, true, {
    intervalMs: SSE_KEEPALIVE_MS,
    keepaliveFrame: ANTHROPIC_PING_FRAME,
    // A late failure becomes an Anthropic `event: error` carrying the HTTP status.
    errorFormat: "claude"
  });
}

/**
 * POST /v1/responses - OpenAI Responses API format.
 * Explicit `stream: true` requests open an early SSE response even when clients
 * omit the Accept header, keeping slow provider setup alive until data arrives.
 */
export async function handleResponses(request) {
  // Codex clients compress Responses bodies; decode before reading `stream`.
  const decoded = await decodeInboundRequest(request, { abortedStatus: 499 });
  if (decoded.response) return decoded.response;
  request = decoded.request;

  const body = await request.clone().json().catch(() => null);

  // Codex CLI and other Responses API consumers may drop the connection if no
  // bytes arrive within a few seconds. Explicit stream intent is authoritative;
  // Accept remains a compatibility fallback for clients that omit `stream`.
  const accept = String(request.headers.get("accept") || "").toLowerCase();
  return chatWithKeepalive(request, body?.stream === true || accept.includes("text/event-stream"), {
    // A late failure becomes a Responses `error` event carrying the HTTP status.
    errorFormat: "responses"
  });
}
