import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import {
  FETCH_CONNECT_TIMEOUT_MS,
  HTTP_STATUS,
  MAX_PROVIDER_BODY_BYTES,
  PROVIDER_BODY_TIMEOUT_MS } from
"../config/runtimeConfig.js";
import {
  generateCursorBody,
  parseConnectRPCFrame,
  extractTextFromResponse,
  parseNativeToolCallsFromText } from
"../utils/cursorProtobuf.js";
import { shouldForceAgentMode } from "../utils/cursorToolMapping.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { estimateUsage } from "../utils/usageTracking.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { chatChunkSse } from "../utils/sse.js";
import { FORMATS } from "../translator/formats.js";
import { proxyAwareFetch, shouldUseProxyAwareTransport } from "../utils/proxyFetch.js";
import {
  runProviderAttemptDispatch,
  runQuotaBearingProviderRequest } from
"../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import zlib from "zlib";
import { createRequire } from "module";

// Detect cloud environment
import { isFunction, isObject, isUndefined } from "@/shared/utils/typeChecks.js";const isCloudEnv = () => {
  if (!isUndefined(caches) && isObject(caches)) return true;
  if (!isUndefined(EdgeRuntime)) return true;
  return false;
};

/**
 * Loads Node's HTTP/2 binding synchronously so CJS-mode transpilers do not
 * inherit a top-level await from this ESM module.
 */
let http2 = null;
if (!isCloudEnv()) {
  try {
    const require = createRequire(import.meta.url);
    http2 = require("http2");
  } catch {

    // http2 not available
  }}

export function __setCursorHttp2ForTesting(value) {
  const previous = http2;
  http2 = value;
  return () => {http2 = previous;};
}

const COMPRESS_FLAG = {
  NONE: 0x00,
  GZIP: 0x01,
  TRAILER: 0x02,
  GZIP_TRAILER: 0x03
};

const CURSOR_STREAM_DEBUG = process.env.CURSOR_STREAM_DEBUG === "1";
const debugLog = (...args) => {
  if (CURSOR_STREAM_DEBUG) console.log(...args);
};

function isComposerModel(model) {
  const modelId = String(model || "").split("/").pop();
  return /^composer(?:-|$)/i.test(modelId);
}

function visibleComposerContentFromThinking(thinking) {
  if (!thinking) return "";
  const endTag = "</think>";
  const endIdx = thinking.lastIndexOf(endTag);
  if (endIdx < 0) return "";
  return thinking.slice(endIdx + endTag.length).trimStart();
}

function decompressPayload(payload, flags, maxOutputLength = MAX_PROVIDER_BODY_BYTES) {
  if (!Number.isSafeInteger(maxOutputLength) || maxOutputLength <= 0 || payload.length > maxOutputLength) {
    return null;
  }
  // Check if payload is JSON error (starts with {"error")
  if (payload.length > 10 && payload[0] === 0x7b && payload[1] === 0x22) {
    try {
      const text = payload.toString("utf-8");
      if (text.startsWith('{"error"')) {
        debugLog(`[DECOMPRESS] Detected JSON error, skipping decompression`);
        return payload;
      }
    } catch {}
  }

  if (
  flags === COMPRESS_FLAG.GZIP ||
  flags === COMPRESS_FLAG.TRAILER ||
  flags === COMPRESS_FLAG.GZIP_TRAILER)
  {
    // Primary: try gzip decompression (standard gzip header 0x1f 0x8b)
    try {
      return zlib.gunzipSync(payload, { maxOutputLength });
    } catch (gzipErr) {
      // Fallback: TRAILER and GZIP_TRAILER frames sometimes use raw zlib deflate format
      try {
        return zlib.inflateSync(payload, { maxOutputLength });
      } catch (deflateErr) {
        // Last resort: try raw deflate (no zlib header)
        try {
          return zlib.inflateRawSync(payload, { maxOutputLength });
        } catch (rawErr) {
          debugLog(
            `[DECOMPRESS ERROR] flags=${flags}, payloadSize=${payload.length}, gzip=${gzipErr.message}, deflate=${deflateErr.message}, raw=${rawErr.message}`
          );
          debugLog(
            `[DECOMPRESS ERROR] First 50 bytes (hex):`,
            payload.slice(0, 50).toString("hex")
          );
          return null;
        }
      }
    }
  }
  return payload;
}

// Read one cursor protobuf frame: header + bounds + decompress. Returns status + payload + new offset.
function readCursorFrame(buffer, offset, frameNum, tag, maxOutputLength = MAX_PROVIDER_BODY_BYTES) {
  if (offset === buffer.length) return { status: "eof", offset };
  if (offset + 5 > buffer.length) {
    debugLog(`[CURSOR BUFFER${tag}] Reached end, offset=${offset}, remaining=${buffer.length - offset}`);
    return { status: "incomplete", offset };
  }

  const flags = buffer[offset];
  const length = buffer.readUInt32BE(offset + 1);
  debugLog(`[CURSOR BUFFER${tag}] Frame ${frameNum + 1}: flags=0x${flags.toString(16).padStart(2, "0")}, length=${length}`);

  if (offset + 5 + length > buffer.length) {
    debugLog(`[CURSOR BUFFER${tag}] Incomplete frame, offset=${offset}, length=${length}, buffer.length=${buffer.length}`);
    return { status: "incomplete", offset };
  }

  let payload = buffer.slice(offset + 5, offset + 5 + length);
  const newOffset = offset + 5 + length;
  payload = decompressPayload(payload, flags, maxOutputLength);
  if (!payload) {
    debugLog(`[CURSOR BUFFER${tag}] Frame ${frameNum + 1}: decompression failed`);
    return { status: "error", offset: newOffset };
  }
  return { status: "ok", payload, offset: newOffset };
}

function createErrorResponse(jsonError) {
  const errorMsg = jsonError?.error?.details?.[0]?.debug?.details?.title ||
  jsonError?.error?.details?.[0]?.debug?.details?.detail ||
  jsonError?.error?.message ||
  "API Error";

  const isRateLimit = jsonError?.error?.code === "resource_exhausted";

  return new Response(JSON.stringify({
    error: {
      message: errorMsg,
      type: isRateLimit ? "rate_limit_error" : "api_error",
      code: jsonError?.error?.details?.[0]?.debug?.error || "unknown"
    }
  }), {
    status: isRateLimit ? HTTP_STATUS.RATE_LIMITED : HTTP_STATUS.BAD_REQUEST,
    headers: { "Content-Type": "application/json" }
  });
}

function createCursorStreamErrorResponse(message, status = HTTP_STATUS.BAD_GATEWAY) {
  return new Response(JSON.stringify({
    error: { message, type: "stream_error", code: "incomplete_stream" }
  }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function cursorAbortError(reason) {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  return new DOMException("Cursor request aborted", "AbortError");
}

function cursorBodyLimitError() {
  return new Error("Cursor response exceeded the configured body limit");
}

export function appendBoundedCursorChunk(state, chunk, maxBytes = MAX_PROVIDER_BODY_BYTES) {
  const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const nextTotal = state.total + value.byteLength;
  if (nextTotal > maxBytes) throw cursorBodyLimitError();
  state.total = nextTotal;
  state.chunks.push(value);
}

function readCursorChunk(reader, combined, signal) {
  if (combined.aborted) {
    return Promise.reject(signal?.aborted ?
    cursorAbortError(signal.reason) :
    new Error("Cursor response body timed out"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      combined.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(
      reject,
      signal?.aborted ? cursorAbortError(signal.reason) : new Error("Cursor response body timed out")
    );
    combined.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

export async function readCursorResponseBody(response, signal, {
  maxBytes = MAX_PROVIDER_BODY_BYTES,
  timeoutMs = PROVIDER_BODY_TIMEOUT_MS
} = {}) {
  if (signal?.aborted) throw cursorAbortError(signal.reason);
  const reader = response?.body?.getReader?.();
  if (!reader) throw new Error("Cursor upstream returned no response body");
  const state = { chunks: [], total: 0 };
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const onAbort = () => {void Promise.resolve(reader.cancel(combined.reason)).catch(() => {});};
  combined.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await readCursorChunk(reader, combined, signal);
      if (done) break;
      appendBoundedCursorChunk(state, value, maxBytes);
    }
    return Buffer.concat(state.chunks, state.total);
  } catch (error) {
    void Promise.resolve(reader.cancel(error)).catch(() => {});
    throw error;
  } finally {
    combined.removeEventListener("abort", onAbort);
    try {reader.releaseLock();} catch {/* noop */}
  }
}

export class CursorExecutor extends BaseExecutor {
  constructor() {
    super("cursor", PROVIDERS.cursor);
  }

  buildUrl() {
    return `${this.config.baseUrl}${this.config.chatPath}`;
  }

  buildHeaders(credentials) {
    const accessToken = credentials.accessToken;
    const machineId = credentials.providerSpecificData?.machineId;
    const ghostMode = credentials.providerSpecificData?.ghostMode !== false;

    if (!machineId) {
      throw new Error("Machine ID is required for Cursor API");
    }

    return buildCursorHeaders(accessToken, machineId, ghostMode);
  }

  transformRequest(model, body, stream, credentials) {
    // Messages are already translated by chatCore (claude→openai→cursor)
    // Do NOT call openaiToCursorRequest again — double-translation drops tool_results
    const messages = body.messages || [];
    const tools = body.tools || [];
    const reasoningEffort = body.reasoning_effort || null;
    const ua = credentials?.rawHeaders?.["user-agent"] || "";
    const forceAgentMode = shouldForceAgentMode(ua);
    return generateCursorBody(messages, model, tools, reasoningEffort, forceAgentMode);
  }

  async makeFetchRequest(url, headers, body, signal, proxyOptions = null) {
    if (signal?.aborted) throw cursorAbortError(signal.reason);
    const connectController = new AbortController();
    const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
    const onAbort = () => connectController.abort(cursorAbortError(signal.reason));
    signal?.addEventListener?.("abort", onAbort, { once: true });
    const timeout = setTimeout(
      () => connectController.abort(new Error("Cursor response headers timed out")),
      timeoutMs
    );
    let response;
    try {
      response = await runQuotaBearingProviderRequest(() => proxyAwareFetch(url, {
        method: "POST",
        headers,
        body,
        signal: connectController.signal
      }, proxyOptions));
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener?.("abort", onAbort);
    }

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await readCursorResponseBody(response, signal)
    };
  }

  makeHttp2Request(url, headers, body, signal) {
    if (!http2) {
      throw new Error("http2 module not available");
    }

    const http2TimeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(cursorAbortError(signal.reason));
        return;
      }
      const urlObj = new URL(url);
      const client = http2.connect(`https://${urlObj.host}`);
      const bodyState = { chunks: [], total: 0 };
      let responseHeaders = {};
      let settled = false;
      let onAbort = null;
      let req = null;

      const closeTransport = (error, destroy) => {
        if (destroy) {
          try {req?.close?.(http2.constants?.NGHTTP2_CANCEL);} catch {/* already closed */}
          try {req?.destroy?.(error);} catch {/* already destroyed */}
          try {client.destroy?.(error);} catch {/* already destroyed */}
          return;
        }
        try {client.close();} catch {/* already closed */}
      };

      // Gracefully close only a complete response. Timeout, abort, and transport
      // errors must destroy the stream/session so a peer cannot keep them alive.
      const finish = (fn, { destroy = false } = {}) => (...args) => {
        if (settled) return;
        settled = true;
        clearTimeout(hangTimeout);
        if (onAbort) signal?.removeEventListener?.("abort", onAbort);
        closeTransport(args[0], destroy);
        fn(...args);
      };

      // Hard timeout: destroy the request and session if the peer never ends.
      const hangTimeout = setTimeout(() => {
        const error = new Error("HTTP/2 request timed out");
        finish(reject, { destroy: true })(error);
      }, http2TimeoutMs);

      client.on("error", finish(reject, { destroy: true }));

      try {
        req = client.request({
          ":method": "POST",
          ":path": urlObj.pathname,
          ":authority": urlObj.host,
          ":scheme": "https",
          ...headers
        });
      } catch (error) {
        finish(reject, { destroy: true })(error);
        return;
      }

      req.on("response", (hdrs) => {responseHeaders = hdrs;});
      req.on("data", (chunk) => {
        if (settled) return;
        try {
          appendBoundedCursorChunk(bodyState, chunk);
        } catch (error) {
          finish(reject, { destroy: true })(error);
        }
      });
      req.on("end", () => {
        const status = Number(responseHeaders[":status"]);
        if (!Number.isInteger(status)) {
          finish(reject, { destroy: true })(new Error("Cursor HTTP/2 response omitted its status"));
          return;
        }
        finish(resolve)({
          status,
          headers: responseHeaders,
          body: Buffer.concat(bodyState.chunks, bodyState.total)
        });
      });
      req.on("error", finish(reject, { destroy: true }));
      req.on("close", () => {
        if (!settled) {
          finish(reject, { destroy: true })(new Error("Cursor HTTP/2 response closed before completion"));
        }
      });

      if (signal) {
        onAbort = () => finish(reject, { destroy: true })(cursorAbortError(signal.reason));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }

      if (settled) return;
      try {
        req.write(body);
        req.end();
      } catch (error) {
        finish(reject, { destroy: true })(error);
      }
    });
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, attemptStartedAt = null, onProviderAttempt = null }) {
    if (signal?.aborted) throw cursorAbortError(signal.reason);
    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    const providerAttemptStartedAt = Number.isSafeInteger(attemptStartedAt) && attemptStartedAt > 0 ?
    attemptStartedAt :
    isFunction(onProviderAttempt) ? onProviderAttempt() : Date.now();
    try {
      const shouldForceFetch = shouldUseProxyAwareTransport(url, proxyOptions);
      const response = http2 && !shouldForceFetch ?
      await runQuotaBearingProviderRequest(() => runProviderAttemptDispatch(
        () => this.makeHttp2Request(url, headers, transformedBody, signal)
      )) :
      await this.makeFetchRequest(url, headers, transformedBody, signal, proxyOptions);

      if (response.status !== 200) {
        const errorResponse = new Response(JSON.stringify({
          error: {
            message: `Cursor upstream returned HTTP ${response.status}`,
            type: "invalid_request_error",
            code: ""
          }
        }), {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        });
        return { response: errorResponse, url, headers, transformedBody: body, attemptStartedAt: providerAttemptStartedAt };
      }

      const transformedResponse = stream !== false ?
      this.transformProtobufToSSE(response.body, model, body) :
      this.transformProtobufToJSON(response.body, model, body);

      return {
        response: transformedResponse,
        url,
        headers,
        transformedBody: body,
        attemptStartedAt: providerAttemptStartedAt,
        terminalProvenance: "validated"
      };
    } catch (error) {
      if (isQuotaDispatchUnavailable(error)) throw error;
      if (error?.name === "AbortError") {
        error.providerAttemptStartedAt = providerAttemptStartedAt;
        throw error;
      }
      const errorResponse = new Response(JSON.stringify({
        error: {
          message: error.message,
          type: "connection_error",
          code: ""
        }
      }), {
        status: HTTP_STATUS.SERVER_ERROR,
        headers: { "Content-Type": "application/json" }
      });
      return { response: errorResponse, url, headers, transformedBody: body, attemptStartedAt: providerAttemptStartedAt };
    }
  }

  transformProtobufToJSON(buffer, model, body) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let offset = 0;
    let totalContent = "";
    let totalThinking = "";
    const toolCalls = [];
    const toolCallsMap = new Map(); // Track streaming tool calls by ID
    const finalizedIds = new Set();
    let frameCount = 0;
    let decompressedTotal = 0;

    debugLog(`[CURSOR BUFFER] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, frameCount, "", MAX_PROVIDER_BODY_BYTES - decompressedTotal);
      if (frame.status === "incomplete") return createCursorStreamErrorResponse("Cursor returned a truncated protobuf frame");
      if (frame.status === "eof") break;
      offset = frame.offset;
      frameCount++;
      if (frame.status === "error") return createCursorStreamErrorResponse("Cursor returned an undecodable protobuf frame");
      const payload = frame.payload;
      decompressedTotal += payload.length;

      // Check for JSON error frames (byte guard: skip toString on non-JSON frames)
      if (payload.length > 0 && payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            debugLog(`[CURSOR BUFFER] Error frame: ${text.slice(0, 500)}`);
            return createErrorResponse(JSON.parse(text));
          }
        } catch {}
      }

      const result = extractTextFromResponse(new Uint8Array(payload));
      debugLog(`[CURSOR DECODED] Frame ${frameCount}:`, result);

      if (result.decodeError) {
        return createCursorStreamErrorResponse("Cursor returned an undecodable protobuf frame");
      }

      if (result.error) {
        debugLog(`[CURSOR BUFFER] Decoded error: ${result.error}`);
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id);
          existing.function.arguments += tc.function.arguments;
          existing.isLast = tc.isLast;
        } else {
          // New tool call
          toolCallsMap.set(tc.id, { ...tc });
        }

        // Push to final array when isLast is true
        if (tc.isLast) {
          const finalToolCall = toolCallsMap.get(tc.id);
          finalizedIds.add(tc.id);
          toolCalls.push({
            id: finalToolCall.id,
            type: finalToolCall.type,
            function: {
              name: finalToolCall.function.name,
              arguments: finalToolCall.function.arguments
            }
          });
        }
      }

      if (result.text) totalContent += result.text;
      if (result.thinking) totalThinking += result.thinking;
    }

    if (frameCount === 0) return createCursorStreamErrorResponse("Cursor returned an empty protobuf stream");

    const visibleComposerContent = isComposerModel(model) ?
    visibleComposerContentFromThinking(totalThinking) :
    "";
    const finalContent = totalContent || visibleComposerContent;

    debugLog(
      `[CURSOR BUFFER] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, finalized toolCalls: ${toolCalls.length}`
    );

    // Finalize all remaining tool calls in map (in case stream ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      // Check if already in final array
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });
      }
    }

    debugLog(`[CURSOR BUFFER] Final toolCalls count: ${toolCalls.length}`);

    if (toolCalls.length === 0 && finalContent) {
      const parsedNative = parseNativeToolCallsFromText(finalContent);
      if (parsedNative.length > 0) {
        debugLog(`[CURSOR BUFFER] Parsed ${parsedNative.length} native text tool call(s)`);
        toolCalls.push(...parsedNative);
      }
    }

    const message = {
      role: "assistant",
      content: finalContent || null
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    const usage = estimateUsage(body, finalContent.length, FORMATS.OPENAI);

    const completion = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
      }],
      usage
    };

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  transformProtobufToSSE(buffer, model, body) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    const chunks = [];
    let offset = 0;
    let totalContent = "";
    let totalThinking = "";
    let emittedComposerThinkingContentLength = 0;
    const toolCalls = [];
    const toolCallsMap = new Map(); // Track streaming tool calls by ID
    const finalizedIds = new Set();
    const emittedToolCallIds = new Set();
    let frameCount = 0;
    let decompressedTotal = 0;

    debugLog(`[CURSOR BUFFER SSE] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, frameCount, " SSE", MAX_PROVIDER_BODY_BYTES - decompressedTotal);
      if (frame.status === "incomplete") return createCursorStreamErrorResponse("Cursor returned a truncated protobuf frame");
      if (frame.status === "eof") break;
      offset = frame.offset;
      frameCount++;
      if (frame.status === "error") return createCursorStreamErrorResponse("Cursor returned an undecodable protobuf frame");
      const payload = frame.payload;
      decompressedTotal += payload.length;

      // Check for JSON error frames (byte-guard: only decode if starts with '{')
      if (payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            debugLog(`[CURSOR BUFFER SSE] Error frame: ${text.slice(0, 500)}`);
            return createErrorResponse(JSON.parse(text));
          }
        } catch {}
      }

      const result = extractTextFromResponse(new Uint8Array(payload));
      debugLog(`[CURSOR DECODED SSE] Frame ${frameCount}:`, result);

      if (result.decodeError) {
        return createCursorStreamErrorResponse("Cursor returned an undecodable protobuf frame");
      }

      if (result.error) {
        debugLog(`[CURSOR BUFFER SSE] Decoded error: ${result.error}`);
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (chunks.length === 0) {
          chunks.push(chatChunkSse({ id: responseId, created, model, delta: { role: "assistant", content: "" } }));
        }

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id);
          const oldArgsLen = existing.function.arguments.length;
          existing.function.arguments += tc.function.arguments;
          existing.isLast = tc.isLast;

          // Stream the delta arguments
          if (tc.function.arguments) {
            emittedToolCallIds.add(tc.id);
            chunks.push(chatChunkSse({
              id: responseId, created, model,
              delta: {
                tool_calls: [
                {
                  index: existing.index,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                  }
                }]

              }
            }));
          }
        } else {
          // New tool call - assign index and add to map
          const toolCallIndex = toolCalls.length;
          finalizedIds.add(tc.id);
          toolCalls.push({ ...tc, index: toolCallIndex });
          toolCallsMap.set(tc.id, { ...tc, index: toolCallIndex });

          // Stream initial tool call with name
          emittedToolCallIds.add(tc.id);
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta: {
              tool_calls: [
              {
                index: toolCallIndex,
                id: tc.id,
                type: "function",
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments
                }
              }]

            }
          }));
        }
      }

      if (result.text) {
        totalContent += result.text;
        chunks.push(chatChunkSse({
          id: responseId, created, model,
          delta:
          chunks.length === 0 && toolCalls.length === 0 ?
          { role: "assistant", content: result.text } :
          { content: result.text }
        }));
      }

      if (isComposerModel(model) && result.thinking) {
        totalThinking += result.thinking;
        const visibleContent = visibleComposerContentFromThinking(totalThinking);
        if (visibleContent.length > emittedComposerThinkingContentLength) {
          const deltaContent = visibleContent.slice(emittedComposerThinkingContentLength);
          emittedComposerThinkingContentLength = visibleContent.length;
          totalContent += deltaContent;
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta:
            chunks.length === 0 && toolCalls.length === 0 ?
            { role: "assistant", content: deltaContent } :
            { content: deltaContent }
          }));
        }
      }
    }

    if (frameCount === 0) return createCursorStreamErrorResponse("Cursor returned an empty protobuf stream");

    debugLog(
      `[CURSOR BUFFER SSE] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, toolCalls array: ${toolCalls.length}`
    );

    // Finalize all remaining tool calls in map (stream may have ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER SSE] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        const toolCallIndex = toolCalls.length;
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          index: toolCallIndex,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });

        // Emit SSE chunk for the finalized tool call if not already emitted
        if (!emittedToolCallIds.has(tc.id)) {
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta: {
              tool_calls: [
              {
                index: toolCallIndex,
                id: tc.id,
                type: "function",
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments
                }
              }]

            }
          }));
        }
      }
    }

    if (chunks.length === 0 && toolCalls.length === 0) {
      chunks.push(chatChunkSse({ id: responseId, created, model, delta: { role: "assistant", content: "" } }));
    }

    const usage = estimateUsage(body, totalContent.length, FORMATS.OPENAI);

    chunks.push(
      `data: ${JSON.stringify({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
        {
          index: 0,
          delta: {},
          finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
        }],

        usage
      })}\n\n`
    );
    chunks.push(SSE_DONE);

    return new Response(chunks.join(""), {
      status: 200,
      headers: { ...SSE_HEADERS }
    });
  }

  async refreshCredentials() {
    return null;
  }
}

export default CursorExecutor;