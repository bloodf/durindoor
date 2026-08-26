import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import { HTTP_STATUS, SSE_KEEPALIVE_MS, STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import { ANTHROPIC_PING_FRAME } from "../../utils/earlyStreamKeepalive.js";
import { createTerminalTracker } from "../../utils/streamTerminal.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../../utils/sseConstants.js";
import { createErrorResult, readBoundedResponseText, sanitizeErrorMessage } from "../../utils/error.js";
import { attachClientFrameTap, finishTrace } from "./proxyTimeline.js";

// Codex returns Responses API SSE → which client format to translate INTO, by request sourceFormat.
// Gemini-family all map to ANTIGRAVITY decoder; unknown sources fall back to OPENAI.
import { isFunction } from "../../../src/shared/utils/typeChecks.js";
const CODEX_SOURCE_TO_TARGET = {
  [FORMATS.OPENAI_RESPONSES]: FORMATS.OPENAI_RESPONSES,
  [FORMATS.CLAUDE]: FORMATS.CLAUDE,
  [FORMATS.ANTIGRAVITY]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI_CLI]: FORMATS.ANTIGRAVITY
};

function hasOutputTokens(usage) {
  const count = Number(
    usage?.completion_tokens ?? usage?.output_tokens ?? usage?.candidatesTokenCount ?? 0
  );
  return Number.isFinite(count) && count > 0;
}

/**
 * Determine which SSE transform stream to use based on provider/format.
 *
 * Returns the emitted format alongside the stream. Anything inspecting the
 * CLIENT-facing frames must key off that, not off `targetFormat`: the three
 * branches below emit three different formats, and translation runs
 * targetFormat → sourceFormat, so the provider's format is the wrong one in two
 * of them. Returning it here keeps the two in lockstep instead of asking callers
 * to re-derive the branch condition.
 *
 * @returns {{stream: TransformStream, emittedFormat: string}}
 */
export function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, model, connectionId, body, providerBody, onStreamComplete, onCoherentTerminal, apiKey, claudeClassifierCompat }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  // Responses-API providers (e.g. codex) emit Responses SSE → translate into client format
  const isResponsesProvider = PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return {
      stream: createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, claudeClassifierCompat, onCoherentTerminal, providerBody),
      emittedFormat: codexTarget
    };
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return {
      stream: createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, claudeClassifierCompat, onCoherentTerminal, providerBody),
      emittedFormat: sourceFormat
    };
  }

  // Passthrough: the provider's own frames reach the client unchanged.
  return {
    stream: createPassthroughStreamWithLogger(provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, targetFormat, onCoherentTerminal, providerBody),
    emittedFormat: targetFormat
  };
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, reqLogger, toolNameMap, streamController, onStreamComplete, onStreamAbandoned, onCoherentTerminal, streamDetailId, pxpipe, reqTag, log, claudeClassifierCompat, signal = null, traceId = null }) {
  const failTimeline = (status) => {
    if (traceId) { try { finishTrace(traceId, { status }); } catch {} }
  };
  if (!providerResponse?.body) {
    const error = new Error("Upstream returned an empty streaming body");
    streamController?.handleError?.(error);
    failTimeline("error");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, error.message);
  }

  // When upstream returns HTML/text instead of SSE (e.g. Cloudflare 5xx error
  // page), piping it through the SSE transform stream causes Next.js
  // "failed to pipe response" and crashes the chat router. Read the body,
  // pull a short human-readable message from the <title>, sanitize it, and
  // return a clean JSON error instead. The message is stripped of HTML tags
  // and clamped so untrusted upstream text never reaches the client verbatim
  // (the UI may render error.message as HTML).
  // Ollama's native /api/chat streams as `application/x-ndjson` (raw JSON
  // lines), never SSE — that's expected for targetFormat OLLAMA and is fully
  // handled by the translate-mode transform stream below (parseSSELine +
  // ollamaToOpenAIResponse, see translator/response/ollama-to-openai.js), so
  // it must not be treated as an upstream error page (issue #2386).
  const upstreamContentType = (providerResponse.headers.get('content-type') || '').toLowerCase();
  const isExpectedOllamaNdjson = targetFormat === FORMATS.OLLAMA && upstreamContentType.includes('application/x-ndjson');
  if (upstreamContentType && !isExpectedOllamaNdjson && !upstreamContentType.includes('text/event-stream') && !upstreamContentType.includes('application/json')) {
    let bodyText = "";
    try {
      bodyText = await readBoundedResponseText(providerResponse, { signal, maxBytes: 16 * 1024, timeoutMs: 2_000 });
    } catch (error) {
      if (error?.name === "AbortError") {
        streamController?.handleError?.(error);
        failTimeline("aborted");
        return createErrorResult(499, "Request aborted");
      }
    }
    const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
    const sanitizedTitle = (titleMatch?.[1] || '').replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    const shortMsg = sanitizeErrorMessage(
      sanitizedTitle || (
      bodyText.length < 200 ?
      bodyText.replace(/<[^>]*>/g, '').trim().slice(0, 160) :
      `Upstream returned non-SSE response (${upstreamContentType})`)
    );
    const status = providerResponse.status || 502;
    if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${status} · ${provider}/${model} · non-SSE (${upstreamContentType})\n    ${shortMsg}`);else
    console.warn(`[STREAM] ${provider} | ${model} | blocked pipe: ${shortMsg} [${status}]`);
    streamController?.handleError?.(new Error(`upstream non-SSE: ${status}`));
    // Use the shared error-result shape (status/error/response) so callers like
    // handleSingleModelChat can correctly log and fall back — a locally built
    // { success, response } object here silently drops status/error and causes
    // the real cause to be lost downstream (see markAccountUnavailable).
    failTimeline("error");
    return createErrorResult(status, `[${status}]: ${shortMsg}`);
  }

  // buildTransformStream returns the FORMAT THE CLIENT ACTUALLY RECEIVES, not
  // the provider's `targetFormat`. The terminal tracker and any later code
  // inspecting the client-facing bytes must key off `emittedFormat`; using
  // `targetFormat` here silently breaks the codex-translation and needsTranslation
  // branches (the provider's format is not what reaches the client in those
  // cases). See upstream PR #3222.
  const { stream: transformStream, emittedFormat } = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, model, connectionId, body, providerBody: finalBody || translatedBody, onStreamComplete, onCoherentTerminal, apiKey, claudeClassifierCompat });

  // Responses passthrough: synthesize response.failed + [DONE] if the stream aborts/stalls before a terminal event
  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough ? buildAbortedResponsesTerminalBytes : null;
  const stallTimeoutMs = PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS;
  const terminalTracker = createTerminalTracker(emittedFormat);
  // Keepalives are client protocol bytes, so select them from emittedFormat
  // after translation. Feeding an Anthropic ping into the provider stream can
  // make translators swallow or misparse it.
  const keepaliveFrame = emittedFormat === FORMATS.CLAUDE ? ANTHROPIC_PING_FRAME : null;
  const clientTap = emittedFormat && traceId
    ? attachClientFrameTap(traceId, emittedFormat === FORMATS.OLLAMA ? "ndjson" : "sse-lines")
    : null;
  const onClientEnd = () => {
    clientTap?.onClientEnd();
    if (traceId) { try { finishTrace(traceId, { status: "ok" }); } catch {} }
  };
  const onClientAbort = () => {
    clientTap?.onClientAbort();
    if (traceId) { try { finishTrace(traceId, { status: "aborted" }); } catch {} }
  };
  // Disconnect-aware piping owns client cancellation; capture transform state
  // before chatCore's lifecycle callbacks race to close the shared detail row.
  streamController.setInterruptionFinalizer?.((reason) => {
    const normalizedReason = reason?.message === "stream stall timeout" ? "stall_timeout" :
    reason?.message ? "stream_error" : reason || "client_disconnected";
    onStreamAbandoned?.(normalizedReason, transformStream.getStreamSnapshot?.() || null);
  });
  const transformedBody = pipeWithDisconnect(
    providerResponse, transformStream, streamController, onAbortTerminal, stallTimeoutMs, terminalTracker,
    clientTap?.onClientBytes || null, onClientEnd, onClientAbort, keepaliveFrame, SSE_KEEPALIVE_MS,
  );

  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: "[Streaming - raw response not captured]",
    response: { content: "[Streaming in progress...]", thinking: null, type: "streaming" },
    pxpipe,
    status: "success"
  }, { id: streamDetailId })).catch((err) => {
    console.error("[RequestDetail] Failed to save streaming request:", err.message);
  });

  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS })
  };
}

/**
 * Build the streaming completion callback: persists request detail + stream
 * usage, then emits one correlated DONE line via the unified logger.
 * @param {object} params
 * @param {string} params.provider - Provider id.
 * @param {string} params.model - Resolved model id.
 * @param {string} params.reqTag - Session-stable colored tag from chatCore.
 * @param {object} [params.log] - Unified logger; `line(tag, symbol, message)`
 *   emits the DONE line when present.
 * @param {number} params.requestStartTime - `Date.now()` at request start (TTFT base).
 * @param {Function} [params.onEmptyStream] - notified after a coherent stream
 *   completes without text, thinking, or generated tokens.
 * @returns {{onStreamComplete: Function, onStreamAbandoned: Function, streamDetailId: string}}
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest, pxpipe, reqTag, log, usageEventId, onRequestSuccess, onEmptyStream, getProviderAttemptStartedAt, terminalProvenance = null }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  let coherentTerminalHandled = false;
  let completed = false;

  const onCoherentTerminal = () => {
    if (
    coherentTerminalHandled || !isFunction(
      onRequestSuccess) ||
    !["upstream", "validated"].includes(terminalProvenance))
    return;
    coherentTerminalHandled = true;
    const attemptStartedAt = isFunction(getProviderAttemptStartedAt) ?
    getProviderAttemptStartedAt() :
    null;
    try {
      Promise.resolve(onRequestSuccess({ attemptStartedAt })).catch(() => {
        // Runtime health cleanup is fail-open and must not break a completed
        // provider stream or echo repository details to the client/logs.
        console.error("[ChatCore] completed-stream cleanup failed");
      });
    } catch {
      console.error("[ChatCore] completed-stream cleanup failed");
    }
  };

  const onStreamComplete = (contentObj, usage, ttftAt, summary) => {
    if (completed) return;
    completed = true;
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: summary?.providerResponse ?? safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming" },
      pxpipe,
      status: "success"
    }, { id: streamDetailId })).catch((err) => {
      console.error("[RequestDetail] Failed to update streaming content:", err.message);
    });

    /**
     * Upstream PR #3111 logs resolved route/session identity from the provider
     * request body without altering client-facing response usage.
     */
    const sessionId = (finalBody || translatedBody)?.conversationState?.conversationId;
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, usageEventId, label: "STREAM USAGE", silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency, provider, model, sessionId }));

    if (
    isFunction(onEmptyStream) &&
    !contentObj?.content?.trim?.() &&
    !contentObj?.thinking?.trim?.() &&
    !hasOutputTokens(usage))
    {
      log?.warn?.("CHATCORE", `${provider}/${model} stream completed with no usable output`);
      try {Promise.resolve(onEmptyStream()).catch(() => console.error("[Stream] empty-stream cooldown failed"));}
      catch {console.error("[Stream] empty-stream cooldown failed");}
    }
  };

  // Finalize the placeholder row when the stream ends without onStreamComplete
  // ever running: client disconnect, upstream stall timeout, or a mid-stream
  // network error. Without this, the row saved by handleStreamingResponse stays
  // "[Streaming in progress...]" with tokens 0/0 and status "success" forever.
  // The `completed` guard (shared with onStreamComplete) makes the two mutually
  // exclusive, so a completion race with a disconnect can never double-write.
  // Reuses streamDetailId so the ON CONFLICT(id) upsert overwrites the placeholder.
  const onStreamAbandoned = (reason, snapshot = null) => {
    if (completed) return;
    completed = true;
    const detail = `[Streaming interrupted: ${reason || "unknown"}]`;
    const safeContent = snapshot?.content || detail;
    const usage = snapshot?.usage || null;
    const latency = {
      ttft: snapshot?.ttftAt ? snapshot.ttftAt - requestStartTime : 0,
      total: Date.now() - requestStartTime
    };
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: snapshot?.thinking || null, type: "streaming" },
      pxpipe,
      status: "cancelled"
    }, { id: streamDetailId })).catch((err) => {
      console.error("[RequestDetail] Failed to finalize interrupted stream:", err.message);
    });

    // Partial provider/estimated usage is billable even when client cancellation
    // prevents transform flush. Mark it cancelled so persistence cannot convert
    // chatCore's asynchronously finalized error session back to done.
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, usageEventId, status: "cancelled", label: "STREAM USAGE (cancelled)", silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency, provider, model }).replace(/^DONE /, "CANCELLED "));
  };

  return { onStreamComplete, onCoherentTerminal, onStreamAbandoned, streamDetailId };
}