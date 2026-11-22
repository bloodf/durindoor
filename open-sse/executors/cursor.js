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
import { resolveCursorModels, resolveAutoModelSelection } from "../services/cursorModels.js";
import { estimateUsage } from "../utils/usageTracking.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import { FORMATS } from "../translator/formats.js";
import { ROLE, OPENAI_BLOCK } from "../translator/schema/index.js";
import { proxyAwareFetch, shouldUseProxyAwareTransport } from "../utils/proxyFetch.js";
import { connectHttp2, cursorProxyUrl } from "../utils/http2Connect.js";
import { credentialFetch } from "../utils/credentialFetch.js";
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
const { isFunction, isObject, isString, isUndefined } = require("../../src/shared/utils/typeChecks.cjs");
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

function textFromContent(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === OPENAI_BLOCK.TEXT && isString(part.text))
    .map((part) => part.text)
    .join("\n");
}

function isTextPart(part) {
  return !part || part.type === OPENAI_BLOCK.TEXT || isString(part);
}

// Operator rollback valve: CURSOR_AGENT_SERVICE=off keeps every request on the legacy ChatService path.
const CURSOR_AGENT_SERVICE_ENABLED = () => String(process.env.CURSOR_AGENT_SERVICE || "").toLowerCase() !== "off";

export function isAgentCapableRequest(body) {
  // ChatService rejects auto/composer and most thinking variants. AgentService
  // can answer text turns (including declared tool schemas) and tool-call
  // history. Image parts still need the legacy protobuf path.
  if (!Array.isArray(body?.messages) || body.messages.length === 0) return false;
  return body.messages.every((message) => {
    if (Array.isArray(message?.content)) return message.content.every(isTextPart);
    return message?.content == null || isString(message.content);
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

// Effort, thinking, and fast picker suffixes can be model parameters. Sending `claude-4.5-opus-high-thinking` as the
// id makes AgentService accept the RPC and stream an empty turn.
const CURSOR_EFFORT_SUFFIXES = ["xhigh", "medium", "high", "low", "max", "minimal", "ultra"];

function encodeModelParameter(id, value) {
  return agentMessage(3, concatBuffers(agentString(1, id), agentString(2, value)));
}

function normalizeBodyEffort(reasoningEffort) {
  const bodyEffort = String(reasoningEffort || "").toLowerCase();
  if (!bodyEffort || bodyEffort === "none") return null;
  if (bodyEffort === "ultra") return "max";
  if (bodyEffort === "minimal") return "low";
  return bodyEffort;
}

function idHasEffortToken(id) {
  return CURSOR_EFFORT_SUFFIXES.some((effort) => (
    id.endsWith(`-${effort}`) || id.includes(`-${effort}-`)
  ));
}

/**
 * Split a Cursor picker id into the base AgentService model_id plus parameters.
 * Claude/Gemini/Grok/Composer use `effort`; GPT uses `reasoning`. `-thinking`
 * and Composer/Fable `-fast` become toggles. Opus/GPT/Grok `*-fast` catalog
 * ids stay intact.
 *
 * Catalog rules (live GetUsableModels):
 * 1. Exact id listed → send verbatim (Cursor often lists effort tiers as full ids).
 * 2. Else strip suffixes only when the resulting base is listed.
 * 3. Else keep the original id — inventing a base that is not usable yields an
 *    empty AgentService turn (seen with gpt-5.6-luna-medium / cursor-grok-*).
 */
export function resolveRequestedModel(modelId, reasoningEffort = null, catalogIds = null) {
  const original = String(modelId || "").trim().split("/").pop() || "";
  const bodyValue = normalizeBodyEffort(reasoningEffort);
  let id = original === "auto" ? "default" : original;

  const attachBodyEffort = (model, params) => {
    if (bodyValue && !idHasEffortToken(model) && !params.some((p) => p.id === "effort" || p.id === "reasoning")) {
      params.push({ id: /gpt-/i.test(model) ? "reasoning" : "effort", value: bodyValue });
    }
    return params;
  };

  // Exact catalog hit: the account's usable list is authoritative.
  if (catalogIds instanceof Set && catalogIds.has(id)) {
    return { modelId: id, parameters: attachBodyEffort(id, []) };
  }

  const parameters = [];
  let working = id;

  // Strip -thinking before effort so `…-high-thinking` becomes base + both params.
  if (working.endsWith("-thinking")) {
    working = working.slice(0, -"-thinking".length);
    parameters.push({ id: "thinking", value: "true" });
  }

  // Composer / Fable `-fast` is a parameter; other families keep catalog `*-fast` ids.
  if (
    (working.startsWith("composer-") || /claude-fable/i.test(working))
    && working.endsWith("-fast")
  ) {
    working = working.slice(0, -"-fast".length);
    parameters.push({ id: "fast", value: "true" });
  }

  let effortFromId = null;
  for (const effort of CURSOR_EFFORT_SUFFIXES) {
    const suffix = `-${effort}`;
    if (working.length > suffix.length && working.endsWith(suffix)) {
      working = working.slice(0, -suffix.length);
      effortFromId = effort === "ultra" ? "max" : effort === "minimal" ? "low" : effort;
      break;
    }
  }

  const stripped = working !== id || parameters.length > 0;
  // Catalog-aware strip:
  // - exact id already handled above
  // - strip only when the resulting base is listed as usable
  // - empty Set = live fetch failed/empty → keep original (invented bases empty-turn)
  // - null catalogIds = unit-test / offline path → allow legacy strip
  if (stripped && catalogIds instanceof Set && (catalogIds.size === 0 || !catalogIds.has(working))) {
    return { modelId: id, parameters: attachBodyEffort(id, []) };
  }

  if (effortFromId) {
    parameters.push({ id: /gpt-/i.test(working) ? "reasoning" : "effort", value: effortFromId });
  } else {
    attachBodyEffort(working, parameters);
  }

  return { modelId: working, parameters };
}

export function buildAgentRunFrame(messages, model, tools = [], reasoningEffort = null, catalogIds = null) {
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
  const { modelId, parameters } = resolveRequestedModel(model, reasoningEffort, catalogIds);
  // RequestedModel field 7 is reserved for Bedrock credentials.
  const requestedModel = concatBuffers(agentString(1, modelId), ...parameters.map((param) => encodeModelParameter(param.id, param.value)));
  const modelDetails = concatBuffers(agentString(1, modelId), agentString(3, modelId), agentString(4, modelId));
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
    if (length > MAX_PROVIDER_BODY_BYTES) throw cursorBodyLimitError();
    if (pending.length < 5 + length) break;
    let payload = pending.subarray(5, 5 + length);
    pending = pending.subarray(5 + length);
    if (flags & COMPRESS_FLAG.GZIP) {
      payload = zlib.gunzipSync(payload, { maxOutputLength: MAX_PROVIDER_BODY_BYTES });
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

function blobStoreKey(blobId) {
  return Buffer.from(blobId || []).toString("hex");
}

/**
 * Answer an AgentService kv_server_message (field 4 of AgentServerMessage).
 * Claude/GPT-backed runs write blobs with set_blob_args and read them back with
 * get_blob_args; a get for a blob this run stored must return that data, not an
 * empty result. Unknown blobs keep the empty-result ack.
 *
 * @param {Map<number, Array<{value: *}>>} kv Decoded kv_server_message.
 * @param {Map<string, Buffer>} blobStore Per-run blob store, mutated by set.
 * @returns {Uint8Array|null} Framed kv_client_message, or null when kv carries neither get nor set.
 */
export function buildKvServerReply(kv, blobStore) {
  const kvId = kv.get(1)?.[0]?.value || 0;
  const metadata = kv.get(4)?.[0]?.value || null;
  if (kv.has(2)) {
    const blobId = decodeMessage(kv.get(2)[0].value).get(1)?.[0]?.value;
    const data = blobId ? blobStore.get(blobStoreKey(blobId)) : null;
    const result = data?.length ? agentMessage(1, data) : agentMessage(1, new Uint8Array());
    return encodeKvClientMessage(kvId, 2, result, metadata);
  }
  if (kv.has(3)) {
    const args = decodeMessage(kv.get(3)[0].value);
    const blobId = args.get(1)?.[0]?.value;
    const blobData = args.get(2)?.[0]?.value;
    if (blobId && blobData) blobStore.set(blobStoreKey(blobId), Buffer.from(blobData));
    return encodeKvClientMessage(kvId, 3, new Uint8Array(), metadata);
  }
  return null;
}

// Cursor's live GetUsableModels catalog has no `claude-fable-*-fast` slugs.
// `-fast` is a real speed-tier id for Opus / GPT / Grok; sending it as Fable's
// RequestedModel.model_id yields HTTP 200 and an empty Agent stream.
export function resolveCursorAgentModel(model) {
  if (!isString(model)) return model;
  if (model.includes("claude-fable-") && model.endsWith("-fast")) return model.slice(0, -"-fast".length);
  return model;
}

const CURSOR_STREAM_DEBUG = process.env.CURSOR_STREAM_DEBUG === "1";
const debugLog = (...args) => {
  if (CURSOR_STREAM_DEBUG) console.log(...args);
};

function isComposerModel(model) {
  const modelId = String(model || "").split("/").pop();
  return /^composer(?:-|$)/i.test(modelId);
}

const COMPOSER_THINK_END = "</think>";
const COMPOSER_FRAMING_PAIRS = [
  ["<|final|>", "<|/final|>"],
  ["<｜final｜>", "<｜/final｜>"],
];

/**
 * Stateful bounded extractor for Composer thinking deltas.
 * Strips only the outer </think> boundary and paired opening/closing framing
 * markers while keeping interior quoted markers, normal markup, and partial
 * non-marker tails intact without replay or unbounded buffering.
 */
function createComposerThinkingExtractor() {
  let phase = "thinking";
  let thinkTail = "";
  let openPending = "";
  let expectedClose = null;
  let closePending = "";

  const pushBody = (chunk) => {
    if (!chunk) return "";
    if (!expectedClose) return chunk;

    const combined = closePending + chunk;
    // A complete closing marker followed only by whitespace may be the real
    // end-of-stream marker; hold it (with the whitespace) until more content
    // or finish() decides.
    const trimmed = combined.trimEnd();
    if (trimmed.length < combined.length && trimmed.endsWith(expectedClose)) {
      const start = trimmed.length - expectedClose.length;
      closePending = combined.slice(start);
      return combined.slice(0, start);
    }
    const maxHold = Math.min(combined.length, expectedClose.length);
    let holdLen = 0;
    for (let len = maxHold; len >= 1; len--) {
      if (combined.endsWith(expectedClose.slice(0, len))) {
        holdLen = len;
        break;
      }
    }
    closePending = holdLen > 0 ? combined.slice(combined.length - holdLen) : "";
    return holdLen > 0 ? combined.slice(0, combined.length - holdLen) : combined;
  };

  const pushOpening = (chunk) => {
    const incoming = openPending === "" ? chunk.trimStart() : chunk;
    if (!incoming) return "";
    openPending += incoming;

    for (const [open, close] of COMPOSER_FRAMING_PAIRS) {
      if (openPending.startsWith(open)) {
        const rest = openPending.slice(open.length);
        openPending = "";
        expectedClose = close;
        phase = "body";
        return pushBody(rest);
      }
    }

    for (const [open] of COMPOSER_FRAMING_PAIRS) {
      if (open.startsWith(openPending)) {
        return "";
      }
    }

    const literal = openPending;
    openPending = "";
    expectedClose = null;
    phase = "body";
    return literal;
  };

  return {
    push(delta) {
      if (!delta || phase === "done") return "";
      if (phase === "thinking") {
        const combined = thinkTail + delta;
        const endIdx = combined.lastIndexOf(COMPOSER_THINK_END);
        if (endIdx < 0) {
          thinkTail = combined.slice(-(COMPOSER_THINK_END.length - 1));
          return "";
        }
        thinkTail = "";
        phase = "opening";
        return pushOpening(combined.slice(endIdx + COMPOSER_THINK_END.length));
      }
      if (phase === "opening") {
        return pushOpening(delta);
      }
      return pushBody(delta);
    },
    finish() {
      const currentPhase = phase;
      const pendingOpen = openPending;
      const pendingClose = closePending;
      const closeMarker = expectedClose;
      phase = "done";
      thinkTail = "";
      openPending = "";
      closePending = "";
      expectedClose = null;

      if (currentPhase === "opening") return pendingOpen;
      if (currentPhase === "body" && pendingClose) {
        // Real closing marker at end of stream: drop it, keep any trailing
        // whitespace verbatim (same as the unframed/no-marker path does).
        if (closeMarker && pendingClose.startsWith(closeMarker)
          && pendingClose.slice(closeMarker.length).trim() === "") {
          return pendingClose.slice(closeMarker.length);
        }
        return pendingClose;
      }
      return "";
    },
  };
}

function visibleComposerContentFromThinking(thinking) {
  if (!thinking) return "";
  const extractor = createComposerThinkingExtractor();
  return extractor.push(thinking) + extractor.finish();
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

// Long-session empty-turn recovery: Cursor occasionally answers a long
// history replay with HTTP 200 and zero deltas (empty turn). One retry on a
// tail-only frame recovers the session instead of failing the client turn.
// Capped at one retry: a retry is another upstream send and must not multiply
// quota-bearing dispatches beyond a single bounded recovery.
const CURSOR_EMPTY_TURN_MAX_RETRIES = (() => {
  const value = Number(process.env.CURSOR_EMPTY_TURN_MAX_RETRIES);
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 1) : 1;
})();

const CURSOR_TAIL_ONLY_THRESHOLD = (() => {
  const value = Number(process.env.CURSOR_TAIL_ONLY_THRESHOLD);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 80;
})();

const CURSOR_EMPTY_TURN_RETRY_DELAY_MS = (() => {
  const value = Number(process.env.CURSOR_EMPTY_TURN_RETRY_DELAY_MS);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 400;
})();

/** Minimal tail for wedged long sessions — drops bulk history and tool XML. */
export function tailOnlyCursorMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages || [];
  const systemMessages = messages.filter(
    (message) => message?.role === ROLE.SYSTEM && !/\[(durindoor|9router)\] Long session/.test(String(message?.content || "")),
  );
  const chatMessages = messages.filter((message) => message?.role !== ROLE.SYSTEM);
  let anchor = chatMessages.length - 1;
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    if (chatMessages[i]?.role === ROLE.USER || chatMessages[i]?.role === ROLE.TOOL) {
      anchor = i;
      break;
    }
  }
  const tailStart = anchor > 0 && chatMessages[anchor - 1]?.role === ROLE.ASSISTANT ? anchor - 1 : anchor;
  const tail = chatMessages.slice(Math.max(0, tailStart));
  const note = {
    role: ROLE.SYSTEM,
    content: `[durindoor] Long session: ${messages.length} messages trimmed to the latest turn. Answer the current request; re-read files if needed.`,
  };
  return [...systemMessages, note, ...tail];
}

/**
 * Retry an empty AgentService turn only when a long-session replay is the
 * likely cause: upstream accepts the request, streams HTTP 200, and closes
 * with zero deltas. A first-message empty turn is a protocol condition, not
 * a wedged replay, and must surface to the client without retry.
 */
function shouldRetryEmptyTurn(messageCount) {
  return messageCount >= CURSOR_TAIL_ONLY_THRESHOLD;
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
      response = await runQuotaBearingProviderRequest(() => credentialFetch((target, init) => proxyAwareFetch(target, init, proxyOptions), url, {
        method: "POST",
        headers,
        body,
        signal: connectController.signal
      }));
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
  async openAgentHttp2Stream(url, headers, signal, proxyOptions = null) {
    if (!http2) {
      throw new Error("HTTP/2 is required for Cursor AgentService (endpoint is h2-only)");
    }

    const urlObj = new URL(url);
    const client = await connectHttp2(url, { proxyUrl: cursorProxyUrl(url, proxyOptions), timeoutMs: this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS, http2Module: http2, signal });
    const chunkQueue = [];
    let waiting = null;
    let ended = false;
    let streamError = null;
    let req = null;
    const idleMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;

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

    let onAbort;
    const close = () => {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
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
    req.on("aborted", () => fail(new Error("Cursor AgentService stream reset")));
    req.on("close", () => {
      if (!ended) fail(new Error("Cursor AgentService stream closed before end"));
    });
    req.on("end", () => {
      if (req.rstCode) { fail(new Error("Cursor AgentService stream reset")); return; }
      ended = true;
      wake({ value: undefined, done: true });
    });

    if (signal) {
      onAbort = () => {
        fail(new Error("Request aborted"));
        close();
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const responseHeaders = new Promise((resolve, reject) => {
      const onEarlyError = (error) => reject(error);
      // Abort or stream close before headers must settle the promise, else the
      // caller waits for the full headers timeout.
      const onEarlyClose = () => reject(cursorAbortError(signal?.reason));
      const onEarlyAbort = () => reject(cursorAbortError(signal?.reason));
      client.once("error", onEarlyError);
      req.once("error", onEarlyError);
      req.once("close", onEarlyClose);
      signal?.addEventListener?.("abort", onEarlyAbort, { once: true });
      if (signal?.aborted) onEarlyAbort();
      req.once("response", (hdrs) => {
        client.off("error", onEarlyError);
        req.off("error", onEarlyError);
        req.off("close", onEarlyClose);
        signal?.removeEventListener?.("abort", onEarlyAbort);
        resolve(hdrs);
      });
    });
    // Callers that never await (early throw paths) must not trigger unhandled rejection.
    responseHeaders.catch(() => {});

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
        // Idle timeout per read: a stalled stream must not hang the turn forever.
        const idleTimer = setTimeout(() => {
          fail(new Error("Cursor AgentService stream idle timed out"));
          close();
        }, idleMs);
        let result;
        try {
          result = await new Promise((resolve) => { waiting = resolve; });
        } finally {
          clearTimeout(idleTimer);
        }
        if (streamError) throw streamError;
        return result || { value: undefined, done: true };
      },
    };
  }

  async executeAgent({ model, body, stream, credentials, signal, log, proxyOptions = null, attemptStartedAt = null }) {
    const agentEndpoint = PROVIDER_OAUTH.cursor?.agentEndpoint;
    if (!agentEndpoint) throw new Error("Cursor AgentService endpoint is not configured");

    const url = `${agentEndpoint}${AGENT_RUN_PATH}`;
    cursorProxyUrl(url, proxyOptions);
    const headers = this.buildHeaders(credentials);
    const requestController = new AbortController();
    if (signal?.aborted) {
      requestController.abort(signal.reason);
    } else if (signal?.addEventListener) {
      signal.addEventListener("abort", () => requestController.abort(signal.reason), { once: true });
    }

    // Empty-turn recovery works on the original client history so each retry
    // re-derives its own frame from a clean base (original vs tail-only).
    const originalMessages = body.messages || [];
    let workingMessages = originalMessages;
    const tools = body.tools || [];
    // "Auto (Server Picks)" / "default" is a picker alias, not an AgentService
    // model id — sending it verbatim yields an empty turn. Resolve it to the
    // account's default agent-capable model from the live catalog before Run.
    const catalog = await resolveCursorModels(credentials, { signal, log, proxyOptions });
    const catalogIds = new Set((catalog?.models || []).map((entry) => entry.id));
    let runModel = model;
    if (model === "default" || model === "auto") {
      const selection = resolveAutoModelSelection(catalog?.models);
      if (selection) {
        log?.info?.("CURSOR", `auto model resolved: ${model} → ${selection.modelId} (${selection.matchedBy})`);
        runModel = selection.modelId;
      }
    }


    const openAgentSession = async (frameMessages) => {
      const session = await this.openAgentHttp2Stream(url, headers, requestController.signal, proxyOptions);
      session.write(buildAgentRunFrame(frameMessages, runModel, tools, body.reasoning_effort || body.reasoning?.effort, catalogIds));
      return session;
    };

    const headersTimeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
    let session;
    let responseHeaders;
    try {
      responseHeaders = await runQuotaBearingProviderRequest(() => runProviderAttemptDispatch(async () => {
        session = await openAgentSession(workingMessages);
        return withCursorTimeout(
          session.responseHeaders,
          headersTimeoutMs,
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
    const blobStore = new Map();
    let composerExtractor = composerModel ? createComposerThinkingExtractor() : null;
    let emittedNativeText = false;
    let emittedText = false;

    const flushComposerPending = (onEvent) => {
      if (!composerExtractor || emittedNativeText) return;
      const tail = composerExtractor.finish();
      if (tail) {
        emittedText = true;
        onEvent({ type: "text", value: tail });
      }
    };

    const flushThinkingFallback = (onEvent) => {
      if (composerModel) {
        flushComposerPending(onEvent);
        return;
      }
      if (emittedText || !thinkingAcc) return;
      const fallback = thinkingAcc.trim();
      if (fallback) {
        emittedText = true;
        onEvent({ type: "text", value: fallback });
      }
    };

    const consume = async (onEvent) => {
      const finishTurn = () => {
        flushThinkingFallback(onEvent);
        finished = true;
        if (emittedText) onEvent({ type: "done" });
        else onEvent({ type: "error", value: "Cursor AgentService returned an empty turn" });
      };
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
                  emittedNativeText = true;
                  emittedText = true;
                  onEvent({ type: "text", value: textDelta });
                }
              }
              // thinking_delta (field 4). Composer (and some Grok variants) put
              // the visible answer after </think> here and never send text_delta.
              if (update.has(4)) {
                const thinkingDelta = extractAgentString(decodeMessage(update.get(4)[0].value), 1);
                if (thinkingDelta) {
                  if (composerModel) {
                    if (!emittedNativeText && composerExtractor) {
                      const deltaContent = composerExtractor.push(thinkingDelta);
                      if (deltaContent) {
                        emittedText = true;
                        onEvent({ type: "text", value: deltaContent });
                      }
                    }
                  } else {
                    thinkingAcc += thinkingDelta;
                  }
                }
              }
              // Keep unsigned reasoning upstream-only for Anthropic clients.
              if (update.has(14)) {
                finishTurn();
              }
            }

            // KvServerMessage (field 4): get/set blob. Ack so the stream proceeds.
            if (serverMessage.has(4)) {
              const reply = buildKvServerReply(decodeMessage(serverMessage.get(4)[0].value), blobStore);
              if (reply) session.write(reply);
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
                  if (composerModel) flushComposerPending(onEvent);
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
        if (!finished) {
          if (requestController.signal.aborted) {
            throw cursorAbortError(requestController.signal.reason);
          }
          finishTurn();
        }
      } finally {
        try { session.end(); } catch {}
        try { session.close(); } catch {}
      }
    };

    // One AgentService attempt on the current working frame. Returns sawContent
    // so the retry policy can tell a wedged long replay from a protocol empty.
    const runAgentTurn = async (onEvent) => {
      finished = false;
      emittedText = false;
      emittedNativeText = false;
      thinkingAcc = "";
      blobStore.clear();
      composerExtractor = composerModel ? createComposerThinkingExtractor() : null;
      pending = Buffer.alloc(0);
      await consume(onEvent);
      return { sawContent: emittedText };
    };

    // Wrap events so we never retry once real output has reached the client.
    let outputStarted = false;
    const makeWrappedEvent = (onEvent) => (event) => {
      if (event.type === "text" || event.type === "thinking" || event.type === "tool_call") outputStarted = true;
      onEvent(event);
    };

    // Retry loop: fresh h2 session per attempt. An empty turn on a long replay
    // swaps to a tail-only frame; any other failure surfaces immediately.
    // While a retry is still available the empty-turn error event is withheld:
    // emitting it would close the SSE stream before recovery can run.
    const runWithRetry = async (onEvent) => {
      outputStarted = false;
      const wrapped = makeWrappedEvent(onEvent);
      let attempt = 0;
      for (;;) {
        let turnError = null;
        const result = await runAgentTurn((event) => {
          if (event.type === "error") turnError = event;
          else wrapped(event);
        });
        if (turnError && shouldRetryEmptyTurn(originalMessages.length) && !outputStarted && attempt < CURSOR_EMPTY_TURN_MAX_RETRIES && !requestController.signal.aborted) {
          attempt++;
          log?.info?.("CURSOR", `empty_turn on ${originalMessages.length}-message session; retry ${attempt}/${CURSOR_EMPTY_TURN_MAX_RETRIES} with tail-only frame`);
          workingMessages = tailOnlyCursorMessages(originalMessages);
          let retryHeaders;
          try {
            retryHeaders = await runQuotaBearingProviderRequest(() => runProviderAttemptDispatch(async () => {
              session = await openAgentSession(workingMessages);
              return withCursorTimeout(
                session.responseHeaders,
                headersTimeoutMs,
                "Cursor AgentService response headers timed out"
              );
            }));
          } catch (error) {
            try { session?.close(); } catch {}
            throw error;
          }
          const retryStatus = Number(retryHeaders[":status"] || 0);
          if (retryStatus !== 200) {
            try { session.close(); } catch {}
            wrapped(turnError);
            return result;
          }
          await new Promise((resolve) => setTimeout(resolve, CURSOR_EMPTY_TURN_RETRY_DELAY_MS));
          continue;
        }
        if (turnError) wrapped(turnError);
        return result;
      }
    };

    if (stream === false) {
      let content = "";
      let reasoning = "";
      let agentError = null;
      const toolCalls = [];
      let finishReason = "stop";
      await runWithRetry((event) => {
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
      const message = { role: "assistant", content: content || null };
      if (reasoning) message.reasoning_content = reasoning;
      if (toolCalls.length) message.tool_calls = toolCalls;
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
        // Defer terminal SSE until runWithRetry settles. Emitting stop on the
        // first empty upstream turn wedges Cursor before the tail-only retry
        // can recover the session.
        let streamedOutput = false;
        let closed = false;
        runWithRetry((event) => {
          if (closed) return;
          if (["text", "thinking", "tool_call"].includes(event.type)) streamedOutput = true;
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
            closed = true;
            // An SSE error frame, not a content delta: a protocol failure must not
            // be rendered to the user as the assistant's reply, and downstream
            // usage tracking must not record the turn as a success.
            controller.enqueue(encoder.encode(sseChunk({ error: { message: event.value, type: "api_error" } })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          } else if (event.type === "done") {
            closed = true;
            controller.enqueue(encoder.encode(chatChunkSse({
              id: responseId, created, model, delta: {},
              finishReason: event.finishReason || "stop",
            })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          }
        }).catch((error) => {
          if (closed) return;
          try {
            if (streamedOutput && !requestController.signal.aborted) {
              controller.enqueue(encoder.encode(sseChunk({ error: { message: error.message, type: "api_error" } })));
              controller.enqueue(encoder.encode(SSE_DONE));
              controller.close();
            } else controller.error(error);
          } catch {}
        });
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
    // AgentService uses the selected CONNECT or SOCKS route for HTTP/2.
    if (CURSOR_AGENT_SERVICE_ENABLED() && isAgentCapableRequest(body)) {
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

      // A successful upstream response without a body cannot contain Cursor frames.
      if (!response.body) {
        return {
          response: new Response(JSON.stringify({ error: { message: "Cursor upstream returned an empty response body", type: "server_error", code: "" } }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          }),
          url, headers, transformedBody: body, attemptStartedAt: providerAttemptStartedAt,
        };
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
    let emittedNativeText = false;
    const composerExtractor = isComposerModel(model) ? createComposerThinkingExtractor() : null;
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
        emittedNativeText = true;
        totalContent += result.text;
        chunks.push(chatChunkSse({
          id: responseId, created, model,
          delta:
          chunks.length === 0 && toolCalls.length === 0 ?
          { role: "assistant", content: result.text } :
          { content: result.text }
        }));
      }

      if (composerExtractor && result.thinking && !emittedNativeText) {
        const deltaContent = composerExtractor.push(result.thinking);
        if (deltaContent) {
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

    if (composerExtractor && !emittedNativeText) {
      const tail = composerExtractor.finish();
      if (tail) {
        totalContent += tail;
        chunks.push(chatChunkSse({
          id: responseId, created, model,
          delta:
          chunks.length === 0 && toolCalls.length === 0 ?
          { role: "assistant", content: tail } :
          { content: tail }
        }));
      }
    }

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
