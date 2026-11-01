import { BaseExecutor } from "./base.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../config/providers.js";
import {
  FETCH_CONNECT_TIMEOUT_MS,
  HTTP_STATUS,
  MAX_PROVIDER_BODY_BYTES,
  PROVIDER_BODY_TIMEOUT_MS } from
"../config/runtimeConfig.js";
import {
  generateCursorBody,
  encodeField,
  wrapConnectRPCFrame,
  decodeMessage,
  parseConnectRPCFrame,
  extractTextFromResponse,
  parseNativeToolCallsFromText,
  encodeMcpTools,
  decodeMcpArgs } from
"../utils/cursorProtobuf.js";
import { shouldForceAgentMode } from "../utils/cursorToolMapping.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { estimateUsage } from "../utils/usageTracking.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import { FORMATS } from "../translator/formats.js";
import { ROLE, OPENAI_BLOCK } from "../translator/schema/index.js";
import { proxyAwareFetch, shouldUseProxyAwareTransport } from "../utils/proxyFetch.js";
import {
  runProviderAttemptDispatch,
  runQuotaBearingProviderRequest,
  transferProviderAttemptDispatch } from
"../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import zlib from "zlib";
import { createRequire } from "module";
import crypto from "crypto";

// Detect cloud environment
const { isFunction, isObject, isUndefined } = require("../../src/shared/utils/typeChecks.cjs");
const isCloudEnv = () => {
  const cachesBinding = "caches" in globalThis ? globalThis.caches : undefined;
  if (!isUndefined(cachesBinding) && isObject(cachesBinding)) return true;
  const edgeRuntime = "EdgeRuntime" in globalThis ? globalThis.EdgeRuntime : undefined;
  if (!isUndefined(edgeRuntime)) return true;
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

const AGENT_RUN_PATH = "/agent.v1.AgentService/Run";
const PROTOBUF_LEN = 2;
const PROTOBUF_VARINT = 0;

function concatBuffers(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const agentString = (field, value) => encodeField(field, PROTOBUF_LEN, value);
const agentMessage = (field, value) => encodeField(field, PROTOBUF_LEN, value);
const agentBool = (field, value) => encodeField(field, PROTOBUF_VARINT, value ? 1 : 0);

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === OPENAI_BLOCK.TEXT && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function isTextPart(part) {
  return !part || part.type === OPENAI_BLOCK.TEXT || typeof part === "string";
}

export function isAgentCapableRequest(body) {
  // ChatService rejects auto/composer and most thinking variants. AgentService
  // can answer text turns (including declared tool schemas) and tool-call
  // history. Image parts still need the legacy protobuf path.
  if (!Array.isArray(body?.messages) || body.messages.length === 0) return false;
  return body.messages.every((message) => {
    if (Array.isArray(message?.content)) return message.content.every(isTextPart);
    return message?.content == null || typeof message.content === "string";
  });
}

function encodeHistoryMessage(message) {
  const content = textFromContent(message?.content);
  const extras = [];
  if (message?.role === ROLE.ASSISTANT && message.tool_calls?.length) {
    for (const tc of message.tool_calls) {
      extras.push(`[tool_call id=${tc.id || ""} name=${tc.function?.name || "tool"} args=${tc.function?.arguments || "{}"}]`);
    }
  }
  if (message?.role === ROLE.TOOL) {
    extras.push(`[tool_result id=${message.tool_call_id || ""}]`);
  }
  const textBody = [content, ...extras].filter(Boolean).join("\n");
  if (!textBody) return null;

  // ConversationHistoryMessage.user / .assistant -> repeated content -> text.
  const text = agentString(1, textBody);
  if (message.role === ROLE.ASSISTANT) {
    return agentMessage(2, agentMessage(1, agentMessage(1, text)));
  }
  return agentMessage(1, agentMessage(1, agentMessage(1, text)));
}

export function buildAgentRunFrame(messages, model, tools = []) {
  // custom_system_prompt (RunRequest field 8) makes AgentService return an
  // empty turn. Fold system text into the current user message instead.
  const system = messages
    .filter((message) => message?.role === ROLE.SYSTEM)
    .map((message) => textFromContent(message.content))
    .filter(Boolean)
    .join("\n\n");
  const chatMessages = messages.filter((message) => message?.role !== ROLE.SYSTEM);
  const currentIndex = [...chatMessages].map((message) => message?.role).lastIndexOf(ROLE.USER);
  const current = currentIndex >= 0 ? chatMessages[currentIndex] : chatMessages.at(-1);
  const history = chatMessages
    .slice(0, currentIndex >= 0 ? currentIndex : -1)
    .map(encodeHistoryMessage)
    .filter(Boolean);
  const rawUser = textFromContent(current?.content) || "Continue.";
  const userText = system ? `${system}\n\n${rawUser}` : rawUser;

  // agent.v1.UserMessageAction.user_message and its optional history.
  // selected_context (3) + mode=1 (4) match cursor-agent's wire format; without
  // them the server may accept the RPC and stream an empty turn.
  const userMessage = concatBuffers(
    agentString(1, userText),
    agentString(2, crypto.randomUUID()),
    agentMessage(3, new Uint8Array()),
    encodeField(4, PROTOBUF_VARINT, 1),
  );
  const conversationHistory = history.length
    ? concatBuffers(...history.map((entry) => agentMessage(1, entry)))
    : null;
  const userAction = concatBuffers(
    agentMessage(1, userMessage),
    ...(conversationHistory ? [agentMessage(7, conversationHistory)] : []),
  );
  const conversationAction = agentMessage(1, userAction);
  const requestedModel = concatBuffers(agentString(1, model), agentBool(7, true));
  // ModelDetails (field 3): thinking variants (Composer, Grok, *-thinking)
  // return an empty turn when only RequestedModel (field 9) is set.
  const modelDetails = concatBuffers(
    agentString(1, model),
    agentString(3, model),
    agentString(4, model),
  );
  const mcpTools = encodeMcpTools(tools);
  const runRequest = concatBuffers(
    // An empty ConversationStateStructure starts a fresh local agent session.
    agentMessage(1, new Uint8Array()),
    agentMessage(2, conversationAction),
    agentMessage(3, modelDetails),
    ...(mcpTools.length ? [agentMessage(4, mcpTools)] : []),
    agentMessage(9, requestedModel),
  );

  // agent.v1.AgentClientMessage.run_request.
  return wrapConnectRPCFrame(agentMessage(1, runRequest));
}

function extractAgentString(message, field) {
  const value = message?.get(field)?.[0]?.value;
  return value ? Buffer.from(value).toString("utf8") : "";
}

function decodeAgentFrames(buffer, onFrame) {
  let pending = Buffer.from(buffer || []);
  while (pending.length >= 5) {
    const flags = pending[0];
    const length = pending.readUInt32BE(1);
    if (pending.length < 5 + length) break;
    let payload = pending.subarray(5, 5 + length);
    pending = pending.subarray(5 + length);
    if (flags & COMPRESS_FLAG.GZIP) {
      payload = zlib.gunzipSync(payload);
    }
    if (!(flags & COMPRESS_FLAG.TRAILER)) onFrame(payload);
  }
  return pending;
}

function execIds(execRequest) {
  const id = Number(execRequest?.get(1)?.[0]?.value || 0);
  const execId = extractAgentString(execRequest, 15);
  return { id, execId };
}

function wrapExecClientMessage(execMsgId, execId, resultField, resultPayload) {
  const parts = [];
  if (execMsgId) parts.push(encodeField(1, PROTOBUF_VARINT, execMsgId));
  parts.push(agentString(15, execId || ""));
  parts.push(encodeField(resultField, PROTOBUF_LEN, resultPayload || new Uint8Array()));
  return wrapConnectRPCFrame(agentMessage(2, concatBuffers(...parts)));
}

function createRequestContextResponse(execRequest) {
  // Tools already go out on AgentRunRequest.mcp_tools. Echoing them again on
  // this ack makes AgentService stall silently (0 SSE bytes until abort).
  const { id, execId } = execIds(execRequest);
  const requestContextSuccess = agentMessage(1, new Uint8Array());
  const requestContextResult = agentMessage(1, requestContextSuccess);
  return wrapExecClientMessage(id, execId, 10, requestContextResult);
}

// ExecServerMessage variant → ExecClientMessage result field (same numbers).
const EXEC_RESULT_FIELD = {
  2: 2, 3: 3, 4: 4, 5: 5, 7: 7, 8: 8, 9: 9, 16: 16, 20: 20, 23: 23,
};

function rejectExecRequest(execRequest) {
  const { id, execId } = execIds(execRequest);
  const variant = [...(execRequest?.keys?.() || [])].find((field) => field !== 1 && field !== 15);
  const resultField = EXEC_RESULT_FIELD[variant];
  if (!resultField) return null;
  // Diagnostics has no rejected variant — empty success unblocks the stream.
  if (variant === 9) return wrapExecClientMessage(id, execId, 9, new Uint8Array());
  const rejected = agentMessage(2, agentString(2, "Tool not available in this environment. Use the MCP tools provided instead."));
  return wrapExecClientMessage(id, execId, resultField, rejected);
}

function encodeKvClientMessage(kvId, resultField, resultPayload, metadata) {
  const parts = [];
  if (kvId) parts.push(encodeField(1, PROTOBUF_VARINT, kvId));
  parts.push(encodeField(resultField, PROTOBUF_LEN, resultPayload || new Uint8Array()));
  if (metadata && metadata.length) parts.push(encodeField(4, PROTOBUF_LEN, metadata));
  return wrapConnectRPCFrame(agentMessage(3, concatBuffers(...parts)));
}

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

function withCursorTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

  /**
   * AgentService (agent.api5.cursor.sh) is HTTP/2-only. Node's fetch/undici speaks
   * HTTP/1.1 and fails with HTTPParserError on the h2 preface — use http2 duplex.
   */
  openAgentHttp2Stream(url, headers, signal) {
    if (!http2) {
      throw new Error("HTTP/2 is required for Cursor AgentService (endpoint is h2-only)");
    }

    const urlObj = new URL(url);
    const client = http2.connect(`https://${urlObj.host}`);
    const chunkQueue = [];
    let waiting = null;
    let ended = false;
    let streamError = null;
    let req = null;

    const wake = (result) => {
      if (!waiting) return;
      const resolve = waiting;
      waiting = null;
      resolve(result);
    };

    const fail = (error) => {
      if (streamError) return;
      streamError = error;
      ended = true;
      wake(null);
    };

    const close = () => {
      try { req?.destroy(); } catch {}
      try { client.close(); } catch {}
    };

    client.on("error", fail);

    req = client.request({
      ":method": "POST",
      ":path": urlObj.pathname,
      ":authority": urlObj.host,
      ":scheme": "https",
      ...headers,
    });

    req.on("error", fail);
    req.on("data", (chunk) => {
      if (waiting) wake({ value: chunk, done: false });
      else chunkQueue.push(chunk);
    });
    req.on("end", () => {
      ended = true;
      wake({ value: undefined, done: true });
    });

    if (signal) {
      const onAbort = () => {
        fail(new Error("Request aborted"));
        close();
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const responseHeaders = new Promise((resolve, reject) => {
      const onEarlyError = (error) => reject(error);
      client.once("error", onEarlyError);
      req.once("error", onEarlyError);
      req.once("response", (hdrs) => {
        client.off("error", onEarlyError);
        req.off("error", onEarlyError);
        resolve(hdrs);
      });
    });

    return {
      responseHeaders,
      write(frame) {
        if (req && !req.destroyed) req.write(Buffer.from(frame));
      },
      end() {
        try { if (req && !req.destroyed) req.end(); } catch {}
      },
      close,
      async read() {
        if (chunkQueue.length) return { value: chunkQueue.shift(), done: false };
        if (ended) {
          if (streamError) throw streamError;
          return { value: undefined, done: true };
        }
        const result = await new Promise((resolve) => { waiting = resolve; });
        if (streamError) throw streamError;
        return result || { value: undefined, done: true };
      },
    };
  }

  async executeAgent({ model, body, stream, credentials, signal, log, proxyOptions = null, attemptStartedAt = null }) {
    const agentEndpoint = PROVIDER_OAUTH.cursor?.agentEndpoint;
    if (!agentEndpoint) throw new Error("Cursor AgentService endpoint is not configured");

    const url = `${agentEndpoint}${AGENT_RUN_PATH}`;
    // The h2 duplex stream bypasses proxyAwareFetch, so it can never carry a
    // proxy. Fail closed rather than open a direct socket that would leak the
    // host IP when any proxy (connection, pool, relay, env) applies.
    if (shouldUseProxyAwareTransport(url, proxyOptions)) {
      throw new Error("Cursor AgentService uses HTTP/2 streaming that cannot honor the configured proxy; refusing to connect directly");
    }
    const headers = this.buildHeaders(credentials);
    const requestController = new AbortController();
    if (signal?.addEventListener) {
      signal.addEventListener("abort", () => requestController.abort(signal.reason), { once: true });
    }

    let session;
    const tools = body.tools || [];
    let responseHeaders;
    try {
      responseHeaders = await runQuotaBearingProviderRequest(() => runProviderAttemptDispatch(async () => {
        session = this.openAgentHttp2Stream(url, headers, requestController.signal);
        session.write(buildAgentRunFrame(body.messages || [], model, tools));
        return withCursorTimeout(
          session.responseHeaders,
          this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS,
          "Cursor AgentService response headers timed out"
        );
      }));
    } catch (error) {
      session?.close();
      if (isQuotaDispatchUnavailable(error) || error?.name === "AbortError") throw error;
      throw new Error(`Cursor AgentService request failed: ${error.message}`);
    }

    const bindDispatch = (result) => {
      transferProviderAttemptDispatch(responseHeaders, result.response);
      return result;
    };
    const status = Number(responseHeaders[":status"] || 0);
    if (status !== 200) {
      // Do not echo the upstream error body to the client (matches the legacy path).
      session.close();
      return bindDispatch({
        response: new Response(JSON.stringify({
          error: { message: `Cursor upstream returned HTTP ${status}`, type: "invalid_request_error", code: "" },
        }), { status: status || HTTP_STATUS.SERVER_ERROR, headers: { "Content-Type": "application/json" } }),
        url,
        headers,
        transformedBody: body,
        responseFormat: FORMATS.OPENAI,
        attemptStartedAt,
      });
    }

    // The Claude SSE translator derives Anthropic's message ID by stripping
    // `chatcmpl-`. Keep the remaining ID in Anthropic's required `msg_` form
    // so strict clients such as Claude Code accept the completed stream.
    const responseId = `chatcmpl-msg_${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const composerModel = isComposerModel(model);
    let pending = Buffer.alloc(0);
    let finished = false;
    let thinkingAcc = "";
    let emittedVisible = 0;
    let emittedText = false;

    const flushThinkingFallback = (onEvent) => {
      if (emittedText || !thinkingAcc) return;
      const fallback = composerModel
        ? visibleComposerContentFromThinking(thinkingAcc)
        : thinkingAcc.trim();
      if (fallback) {
        emittedText = true;
        onEvent({ type: "text", value: fallback });
      }
    };

    const consume = async (onEvent) => {
      try {
        while (!finished) {
          const { done, value } = await session.read();
          if (done) break;
          pending = Buffer.concat([pending, Buffer.from(value)]);
          pending = decodeAgentFrames(pending, (payload) => {
            // A single read can carry several frames; once the turn is over the
            // rest of the batch must not reach the already-closed controller.
            if (finished) return;
            const serverMessage = decodeMessage(payload);

            // agent.v1.AgentServerMessage.interaction_update
            if (serverMessage.has(1)) {
              const update = decodeMessage(serverMessage.get(1)[0].value);
              if (update.has(1)) {
                const textDelta = extractAgentString(decodeMessage(update.get(1)[0].value), 1);
                if (textDelta) {
                  emittedText = true;
                  onEvent({ type: "text", value: textDelta });
                }
              }
              // thinking_delta (field 4). Composer (and some Grok variants) put
              // the visible answer after </think> here and never send text_delta.
              if (update.has(4)) {
                const thinkingDelta = extractAgentString(decodeMessage(update.get(4)[0].value), 1);
                if (thinkingDelta) {
                  thinkingAcc += thinkingDelta;
                  if (composerModel) {
                    const visible = visibleComposerContentFromThinking(thinkingAcc);
                    if (visible.length > emittedVisible) {
                      const deltaContent = visible.slice(emittedVisible);
                      emittedVisible = visible.length;
                      emittedText = true;
                      onEvent({ type: "text", value: deltaContent });
                    }
                  }
                }
              }
              // Keep unsigned reasoning upstream-only for Anthropic clients.
              if (update.has(14)) {
                flushThinkingFallback(onEvent);
                finished = true;
                onEvent({ type: "done" });
              }
            }

            // KvServerMessage (field 4): get/set blob. Ack so the stream proceeds.
            if (serverMessage.has(4)) {
              const kv = decodeMessage(serverMessage.get(4)[0].value);
              const kvId = kv.get(1)?.[0]?.value || 0;
              const metadata = kv.get(4)?.[0]?.value || null;
              if (kv.has(2)) {
                session.write(encodeKvClientMessage(kvId, 2, agentMessage(1, new Uint8Array()), metadata));
              } else if (kv.has(3)) {
                session.write(encodeKvClientMessage(kvId, 3, new Uint8Array(), metadata));
              }
            }

            // AgentService requests IDE context before producing a response.
            if (serverMessage.has(2)) {
              const execRequest = decodeMessage(serverMessage.get(2)[0].value);
              if (execRequest.has(10)) {
                log?.info?.("CURSOR", "AgentService request_context ack");
                session.write(createRequestContextResponse(execRequest));
              } else if (execRequest.has(11)) {
                const mcp = decodeMcpArgs(execRequest.get(11)[0].value);
                const name = mcp.toolName || mcp.name;
                if (name) {
                  log?.info?.("CURSOR", `AgentService MCP tool_call ${name}`);
                  finished = true;
                  onEvent({
                    type: "tool_call",
                    value: {
                      id: mcp.toolCallId || `call_${crypto.randomUUID()}`,
                      name,
                      arguments: JSON.stringify(mcp.args || {}),
                    },
                  });
                  onEvent({ type: "done", finishReason: "tool_calls" });
                } else {
                  debugLog(`[CURSOR AGENT] Unsupported exec request fields: ${[...execRequest.keys()].join(",")}`);
                  finished = true;
                  onEvent({ type: "error", value: "Cursor AgentService requested an unsupported IDE tool" });
                }
              } else {
                // Auto/Composer often probe IDE builtins (shell/read/…). Reject
                // them so the model can continue with MCP tools or a text answer
                // instead of stalling the h2 stream.
                const rejection = rejectExecRequest(execRequest);
                if (rejection) {
                  log?.info?.("CURSOR", `AgentService rejected IDE exec fields=${[...execRequest.keys()].join(",")}`);
                  session.write(rejection);
                } else {
                  debugLog(`[CURSOR AGENT] Unsupported exec request fields: ${[...execRequest.keys()].join(",")}`);
                  finished = true;
                  onEvent({ type: "error", value: "Cursor AgentService requested an unsupported IDE tool" });
                }
              }
            }
          });
        }
      } finally {
        try { session.end(); } catch {}
        try { session.close(); } catch {}
        if (!finished) {
          flushThinkingFallback(onEvent);
          onEvent({ type: "done" });
        }
      }
    };

    if (stream === false) {
      let content = "";
      let reasoning = "";
      let agentError = null;
      const toolCalls = [];
      let finishReason = "stop";
      await consume((event) => {
        if (event.type === "text") content += event.value;
        else if (event.type === "thinking") reasoning += event.value;
        else if (event.type === "tool_call") {
          toolCalls.push({
            id: event.value.id,
            type: "function",
            function: { name: event.value.name, arguments: event.value.arguments },
          });
          finishReason = "tool_calls";
        }
        else if (event.type === "error") agentError = event.value;
        else if (event.type === "done" && event.finishReason) finishReason = event.finishReason;
      });
      if (agentError) {
        return bindDispatch({
          response: new Response(JSON.stringify({ error: { message: agentError, type: "api_error" } }), {
            status: HTTP_STATUS.BAD_REQUEST,
            headers: { "Content-Type": "application/json" },
          }),
          url,
          headers,
          transformedBody: body,
          responseFormat: FORMATS.OPENAI,
          attemptStartedAt,
        });
      }
      const message = {
        role: "assistant",
        content: content || null,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      };
      return bindDispatch({
        response: new Response(JSON.stringify({
          id: responseId,
          object: "chat.completion",
          created,
          model,
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: estimateUsage(body, content.length, FORMATS.OPENAI),
        }), { headers: { "Content-Type": "application/json" } }),
        url,
        headers,
        transformedBody: body,
        responseFormat: FORMATS.OPENAI,
        attemptStartedAt,
      });
    }

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      start(controller) {
        consume((event) => {
          if (event.type === "text") {
            controller.enqueue(encoder.encode(chatChunkSse({ id: responseId, created, model, delta: { content: event.value } })));
          } else if (event.type === "thinking") {
            controller.enqueue(encoder.encode(chatChunkSse({ id: responseId, created, model, delta: { reasoning_content: event.value } })));
          } else if (event.type === "tool_call") {
            controller.enqueue(encoder.encode(chatChunkSse({
              id: responseId, created, model,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: event.value.id,
                  type: "function",
                  function: { name: event.value.name, arguments: event.value.arguments },
                }],
              },
            })));
          } else if (event.type === "error") {
            // An SSE error frame, not a content delta: a protocol failure must not
            // be rendered to the user as the assistant's reply, and downstream
            // usage tracking must not record the turn as a success.
            controller.enqueue(encoder.encode(sseChunk({ error: { message: event.value, type: "api_error" } })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          } else if (event.type === "done") {
            controller.enqueue(encoder.encode(chatChunkSse({
              id: responseId, created, model, delta: {},
              finishReason: event.finishReason || "stop",
            })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          }
        }).catch((error) => controller.error(error));
      },
      cancel() {
        requestController.abort();
      },
    });

    return bindDispatch({
      response: new Response(responseStream, { headers: SSE_HEADERS }),
      url,
      headers,
      transformedBody: body,
      responseFormat: FORMATS.OPENAI,
      attemptStartedAt,
    });
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, attemptStartedAt = null, onProviderAttempt = null }) {
    if (signal?.aborted) throw cursorAbortError(signal.reason);
    if (isAgentCapableRequest(body)) {
      const agentAttemptStartedAt = Number.isSafeInteger(attemptStartedAt) && attemptStartedAt > 0 ?
      attemptStartedAt :
      isFunction(onProviderAttempt) ? onProviderAttempt() : Date.now();
      try {
        return await this.executeAgent({ model, body, stream, credentials, signal, log, proxyOptions, attemptStartedAt: agentAttemptStartedAt });
      } catch (error) {
        if (isQuotaDispatchUnavailable(error)) throw error;
        if (error?.name === "AbortError") {
          error.providerAttemptStartedAt = agentAttemptStartedAt;
          throw error;
        }
        return {
          response: new Response(JSON.stringify({
            error: { message: error.message, type: "connection_error", code: "" },
          }), { status: HTTP_STATUS.SERVER_ERROR, headers: { "Content-Type": "application/json" } }),
          url: `${PROVIDER_OAUTH.cursor?.agentEndpoint || ""}${AGENT_RUN_PATH}`,
          headers: {},
          transformedBody: body,
          attemptStartedAt: agentAttemptStartedAt,
        };
      }
    }
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