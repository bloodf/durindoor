/**
 * Windsurf executor for the Codeium/Windsurf gRPC-web chat transport.
 *
 * The upstream endpoint expects a gRPC-web data frame containing a small
 * protobuf GetChatMessage request. Keep this encoder local and dependency-free:
 * it only implements the string, nested-message, and varint fields used by the
 * current LanguageServerService/GetChatMessage wire shape. The response bridge
 * preserves OpenAI chat-completions semantics: streaming requests emit SSE
 * chunks, while `stream: false` requests collect gRPC-web chunks into one JSON
 * `chat.completion` object.
 */
import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { abortable, createExecutorSender, requestAbortError, withBillableDispatch } from "./sendRequest.js";
import { isValidHttpHeaderName } from "./websession-utils.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const WS_BASE_URL = "https://server.self-serve.windsurf.com";
const WS_SERVICE = "exa.language_server_pb.LanguageServerService";
const WS_METHOD_CHAT = "GetChatMessage";
const WS_CHAT_URL = `${WS_BASE_URL}/${WS_SERVICE}/${WS_METHOD_CHAT}`;

const WS_IDE_NAME = "windsurf";
const WS_IDE_VERSION = "3.14.0";
const WS_EXT_VERSION = "3.14.0";
const WS_LOCALE = "en-US";

const MODEL_ALIAS_MAP = {
  "swe-1.6-fast": "swe-1-6-fast",
  "swe-1.6": "swe-1-6",
  "swe-1.5-fast": "swe-1p5",
  "swe-1.5": "swe-1p5",
  "claude-opus-4.7-max": "claude-opus-4-7-max",
  "claude-opus-4.7-xhigh": "claude-opus-4-7-xhigh",
  "claude-opus-4.7-high": "claude-opus-4-7-high",
  "claude-opus-4.7-medium": "claude-opus-4-7-medium",
  "claude-opus-4.7-low": "claude-opus-4-7-low",
  "claude-opus-4.7-review": "opus-4-7-review",
  "claude-sonnet-4.6-thinking-1m": "claude-sonnet-4-6-thinking-1m",
  "claude-sonnet-4.6-1m": "claude-sonnet-4-6-1m",
  "claude-sonnet-4.6-thinking": "claude-sonnet-4-6-thinking",
  "claude-sonnet-4.6": "claude-sonnet-4-6",
  "claude-opus-4.6-thinking": "claude-opus-4-6-thinking",
  "claude-opus-4.6": "claude-opus-4-6",
  "claude-opus-4.5-thinking": "MODEL_CLAUDE_4_5_OPUS_THINKING",
  "claude-opus-4.5": "MODEL_CLAUDE_4_5_OPUS",
  "claude-sonnet-4.5-thinking": "MODEL_PRIVATE_3",
  "claude-sonnet-4.5": "MODEL_PRIVATE_2",
  "claude-haiku-4.5": "MODEL_PRIVATE_11",
  "claude-4.5-opus-thinking": "MODEL_CLAUDE_4_5_OPUS_THINKING",
  "claude-4.5-opus": "MODEL_CLAUDE_4_5_OPUS",
  "claude-4.5-sonnet-thinking": "MODEL_PRIVATE_3",
  "claude-4.5-sonnet": "MODEL_PRIVATE_2",
  "claude-4.5-haiku": "MODEL_PRIVATE_11",
  "gpt-5.5-xhigh-fast": "gpt-5-5-xhigh-priority",
  "gpt-5.5-high-fast": "gpt-5-5-high-priority",
  "gpt-5.5-medium-fast": "gpt-5-5-medium-priority",
  "gpt-5.5-low-fast": "gpt-5-5-low-priority",
  "gpt-5.5-none-fast": "gpt-5-5-none-priority",
  "gpt-5.5-xhigh": "gpt-5-5-xhigh",
  "gpt-5.5-high": "gpt-5-5-high",
  "gpt-5.5-medium": "gpt-5-5-medium",
  "gpt-5.5-low": "gpt-5-5-low",
  "gpt-5.5-none": "gpt-5-5-none",
  "gpt-5.5-review": "gpt-5-5-review",
  "gpt-5.5": "gpt-5-5-medium",
  "gpt-5.4-xhigh-fast": "gpt-5-4-xhigh-priority",
  "gpt-5.4-high-fast": "gpt-5-4-high-priority",
  "gpt-5.4-medium-fast": "gpt-5-4-medium-priority",
  "gpt-5.4-low-fast": "gpt-5-4-low-priority",
  "gpt-5.4-none-fast": "gpt-5-4-none-priority",
  "gpt-5.4-xhigh": "gpt-5-4-xhigh",
  "gpt-5.4-high": "gpt-5-4-high",
  "gpt-5.4-medium": "gpt-5-4-medium",
  "gpt-5.4-low": "gpt-5-4-low",
  "gpt-5.4-none": "gpt-5-4-none",
  "gpt-5.4-mini-xhigh": "gpt-5-4-mini-xhigh",
  "gpt-5.4-mini-high": "gpt-5-4-mini-high",
  "gpt-5.4-mini-medium": "gpt-5-4-mini-medium",
  "gpt-5.4-mini-low": "gpt-5-4-mini-low",
  "gpt-5.4": "gpt-5-4-medium",
  "gpt-5.3-codex-xhigh-fast": "gpt-5-3-codex-xhigh-priority",
  "gpt-5.3-codex-high-fast": "gpt-5-3-codex-high-priority",
  "gpt-5.3-codex-medium-fast": "gpt-5-3-codex-medium-priority",
  "gpt-5.3-codex-low-fast": "gpt-5-3-codex-low-priority",
  "gpt-5.3-codex-xhigh": "gpt-5-3-codex-xhigh",
  "gpt-5.3-codex-high": "gpt-5-3-codex-high",
  "gpt-5.3-codex-medium": "gpt-5-3-codex-medium",
  "gpt-5.3-codex-low": "gpt-5-3-codex-low",
  "gpt-5.3-codex": "gpt-5-3-codex-medium",
  "gpt-5.2-xhigh": "MODEL_GPT_5_2_XHIGH",
  "gpt-5.2-high": "MODEL_GPT_5_2_HIGH",
  "gpt-5.2-medium": "MODEL_GPT_5_2_MEDIUM",
  "gpt-5.2-low": "MODEL_GPT_5_2_LOW",
  "gpt-5.2-none": "MODEL_GPT_5_2_NONE",
  "gpt-5.2": "MODEL_GPT_5_2_MEDIUM",
  "gpt-5": "gpt-5",
  "gpt-4.1": "MODEL_CHAT_GPT_4_1_2025_04_14",
  "gpt-4.1-mini": "gpt-4.1-mini",
  "gpt-4o": "MODEL_CHAT_GPT_4O_2024_08_06",
  "gemini-3.1-pro-high": "gemini-3-1-pro-high",
  "gemini-3.1-pro-low": "gemini-3-1-pro-low",
  "gemini-3.1-pro": "gemini-3-1-pro-high",
  "gemini-3.0-flash-high": "MODEL_GOOGLE_GEMINI_3_0_FLASH_HIGH",
  "gemini-3.0-flash-medium": "MODEL_GOOGLE_GEMINI_3_0_FLASH_MEDIUM",
  "gemini-3.0-flash-low": "MODEL_GOOGLE_GEMINI_3_0_FLASH_LOW",
  "gemini-3.0-flash-minimal": "MODEL_GOOGLE_GEMINI_3_0_FLASH_MINIMAL",
  "gemini-3.0-flash": "MODEL_GOOGLE_GEMINI_3_0_FLASH_HIGH",
  "gemini-2.5-pro": "MODEL_GOOGLE_GEMINI_2_5_PRO",
  "deepseek-v4": "deepseek-v4",
  "kimi-k2.6": "kimi-k2-6",
  "kimi-k2.5": "kimi-k2-5",
  "glm-5.1": "glm-5-1"
};

/**
 * Error code of a Windsurf attempt the upstream accepted but did not complete:
 * output frames arrived, or the 200 body failed after it was accepted. The
 * gateway ends the request on the selected account instead of replaying it.
 */
export const WINDSURF_OUTCOME_UNKNOWN = "upstream_outcome_unknown";

// Trusted gRPC status codes with a fixed gateway meaning. Only the numeric
// status is read; grpc-message and error chunks never leave the executor.
// PERMISSION_DENIED (7) keeps the existing 502 contract.
const GRPC_TYPED_FAILURES = {
  16: { status: 401, type: "authentication_error", code: "invalid_credentials", message: "Windsurf authentication failed" },
  8: { status: 429, type: "rate_limit_error", code: "quota_exceeded", message: "Windsurf quota exhausted" }
};
const ACCEPTED_FAILURE = {
  status: 502,
  type: "upstream_error",
  code: WINDSURF_OUTCOME_UNKNOWN,
  message: "Windsurf accepted the request but did not complete it. It was not retried; check the conversation before sending it again."
};

// Executor-built failure responses and their fixed gateway classification.
const executorFailures = new WeakMap();

const TEXT_ENC = new TextEncoder();
const TEXT_DEC = new TextDecoder();

function resolveWsModelId(model) {
  return MODEL_ALIAS_MAP[model] ?? model;
}

function encodeVarint(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push(v & 0x7f | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

function concatBytes(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function encodeField(fieldNum, payload) {
  return concatBytes([encodeVarint(fieldNum << 3 | 2), encodeVarint(payload.length), payload]);
}

function encodeString(fieldNum, value) {
  return encodeField(fieldNum, TEXT_ENC.encode(value));
}

function buildMetadata(apiKey, sessionId) {
  return concatBytes([
  encodeString(1, apiKey),
  encodeString(2, WS_IDE_NAME),
  encodeString(3, WS_IDE_VERSION),
  encodeString(4, WS_EXT_VERSION),
  encodeString(5, sessionId),
  encodeString(6, WS_LOCALE)]
  );
}

function buildModelOrAlias(model) {
  return encodeString(1, model);
}

function buildChatMessage(msg) {
  const parts = [encodeString(1, msg.role), encodeString(2, msg.content)];
  if (msg.toolCallId) parts.push(encodeString(3, msg.toolCallId));
  return concatBytes(parts);
}

function buildGetChatMessageRequest(apiKey, model, messages) {
  const sessionId = randomUUID();
  const cascadeId = randomUUID();
  const parts = [
  encodeField(1, buildMetadata(apiKey, sessionId)),
  encodeString(2, cascadeId),
  encodeField(3, buildModelOrAlias(model))];

  for (const msg of messages) {
    parts.push(encodeField(4, buildChatMessage(msg)));
  }
  return concatBytes(parts);
}

function grpcWebFrame(payload) {
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = 0x00;
  new DataView(frame.buffer).setUint32(1, payload.length, false);
  frame.set(payload, 5);
  return frame;
}

function readVarint(buf, offset) {
  let result = 0;
  let shift = 0;
  while (offset < buf.length) {
    const b = buf[offset++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [result >>> 0, offset];
    shift += 7;
  }
  return [result >>> 0, offset];
}

function skipWireValue(buf, offset, wireType) {
  if (wireType === 0) return readVarint(buf, offset)[1];
  if (wireType === 1) return Math.min(offset + 8, buf.length);
  if (wireType === 5) return Math.min(offset + 4, buf.length);
  if (wireType === 2) {
    const [len, next] = readVarint(buf, offset);
    return Math.min(next + len, buf.length);
  }
  return buf.length;
}

function decodeStringField(buf, targetField) {
  let offset = 0;
  while (offset < buf.length) {
    const [tag, tagOffset] = readVarint(buf, offset);
    offset = tagOffset;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      const [len, next] = readVarint(buf, offset);
      offset = next;
      if (offset + len > buf.length) return null;
      const payload = buf.slice(offset, offset + len);
      offset += len;
      if (fieldNum === targetField) return TEXT_DEC.decode(payload);
    } else {
      offset = skipWireValue(buf, offset, wireType);
    }
  }
  return null;
}

function decodeDoneChunk(buf) {
  let offset = 0;
  let usageBytes = null;
  while (offset < buf.length) {
    const [tag, tagOffset] = readVarint(buf, offset);
    offset = tagOffset;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      const [len, next] = readVarint(buf, offset);
      offset = next;
      if (offset + len > buf.length) break;
      if (fieldNum === 1) usageBytes = buf.slice(offset, offset + len);
      offset += len;
    } else {
      offset = skipWireValue(buf, offset, wireType);
    }
  }
  if (!usageBytes) return [0, 0];

  let promptTokens = 0;
  let completionTokens = 0;
  offset = 0;
  while (offset < usageBytes.length) {
    const [tag, tagOffset] = readVarint(usageBytes, offset);
    offset = tagOffset;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      const [value, next] = readVarint(usageBytes, offset);
      offset = next;
      if (fieldNum === 1) promptTokens = value;
      if (fieldNum === 2) completionTokens = value;
    } else {
      offset = skipWireValue(usageBytes, offset, wireType);
    }
  }
  return [promptTokens, completionTokens];
}

function decodeCompletionChunk(buf) {
  let offset = 0;
  while (offset < buf.length) {
    const [tag, tagOffset] = readVarint(buf, offset);
    offset = tagOffset;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType !== 2) {
      offset = skipWireValue(buf, offset, wireType);
      continue;
    }

    const [len, next] = readVarint(buf, offset);
    offset = next;
    if (offset + len > buf.length) break;
    const payload = buf.slice(offset, offset + len);
    offset += len;

    if (fieldNum === 1) {
      const text = decodeStringField(payload, 1);
      if (text != null) return { kind: "content", text };
    } else if (fieldNum === 3) {
      const [promptTokens, completionTokens] = decodeDoneChunk(payload);
      return { kind: "done", promptTokens, completionTokens };
    } else if (fieldNum === 4) {
      return {
        kind: "error",
        message: decodeStringField(payload, 1) || "unknown windsurf error"
      };
    }
  }
  return { kind: "unknown" };
}

function openAIMessagesToWs(messages) {
  const out = [];
  for (const m of messages) {
    const role = String(m?.role || "user");
    let content = "";
    if (isString(m?.content)) {
      content = m.content;
    } else if (Array.isArray(m?.content)) {
      for (const part of m.content) {
        if (part && isObject(part) && part.type === "text") {
          content += String(part.text || "");
        }
      }
    }
    out.push({ role, content, toolCallId: m?.tool_call_id });
  }
  return out;
}

function hasToolCalling(messages, tools, functions, functionCall) {
  if (Array.isArray(tools) && tools.length > 0) return true;
  if (Array.isArray(functions) && functions.length > 0) return true;
  if (functionCall && functionCall !== "none") return true;
  for (const m of messages || []) {
    const role = String(m?.role || "").toLowerCase();
    if (role === "tool") return true;
    if (role === "function") return true;
    if (Array.isArray(m?.tool_calls) && m.tool_calls.length > 0) return true;
    if (m?.function_call) return true;
  }
  return false;
}

function hasUnsupportedMedia(messages) {
  for (const m of messages || []) {
    if (Array.isArray(m?.content)) {
      for (const part of m.content) {
        if (part && isObject(part) && part.type && part.type !== "text") {
          return true;
        }
      }
    }
  }
  return false;
}

function toolCallingNotSupportedResponse() {
  return new Response(JSON.stringify({
    error: { message: "Tool calling is not supported for Windsurf", type: "invalid_request_error", code: "unsupported_parameter" }
  }), { status: 400, headers: { "Content-Type": "application/json" } });
}

function mediaNotSupportedResponse() {
  return new Response(JSON.stringify({
    error: { message: "Media files are not supported for Windsurf", type: "invalid_request_error", code: "unsupported_parameter" }
  }), { status: 400, headers: { "Content-Type": "application/json" } });
}

function decodeGrpcWebCompletion(bytes) {
  const result = {
    ok: false,
    error: null,
    output: false,
    grpcStatus: null,
    contentParts: [],
    promptTokens: 0,
    completionTokens: 0
  };
  const parsed = parseGrpcWebFrames(bytes);
  // A content or usage frame means the upstream started generating, even when
  // a truncated frame follows. An error chunk alone is not output.
  result.output = parsed.frames.some((frame) => {
    if (frame.flag !== 0x00) return false;
    const chunk = decodeCompletionChunk(frame.payload);
    return chunk.kind === "content" && Boolean(chunk.text) || chunk.kind === "done";
  });
  if (parsed.incomplete) {
    result.error = "Incomplete gRPC-web frame";
    return result;
  }
  for (const frame of parsed.frames) {
    if (frame.flag === 0x80) {
      const trailer = TEXT_DEC.decode(frame.payload);
      const statusMatch = /(?:^|\r?\n)grpc-status:\s*(\d{1,2})\s*(?:\r?\n|$)/i.exec(trailer);
      if (statusMatch) {
        result.grpcStatus = Number(statusMatch[1]);
        if (statusMatch[1] === "0") {
          result.ok = true;
        } else {
          result.error = `gRPC status ${statusMatch[1]}`;
        }
      }
      continue;
    }
    if (frame.flag !== 0x00) continue;

    const chunk = decodeCompletionChunk(frame.payload);
    if (chunk.kind === "content" && chunk.text) {
      result.contentParts.push(chunk.text);
    } else if (chunk.kind === "done") {
      result.promptTokens = chunk.promptTokens;
      result.completionTokens = chunk.completionTokens;
    } else if (chunk.kind === "error") {
      result.error = "Windsurf upstream error";
    }
  }
  if (!result.ok && !result.error) {
    result.error = "Missing gRPC OK trailer";
  }
  return result;
}

/** The numeric grpc-status of a trailers-only response sent as HTTP headers. */
function headerGrpcStatus(headers) {
  const value = headers?.get?.("grpc-status");
  return isString(value) && /^\d{1,2}$/.test(value.trim()) ? Number(value.trim()) : null;
}

function failureResponse(failure, message = failure.message, code = failure.code) {
  const response = new Response(JSON.stringify({
    error: { message, type: failure.status === 502 ? "windsurf_error" : failure.type, code }
  }), { status: failure.status, headers: { "Content-Type": "application/json" } });
  executorFailures.set(response, failure);
  return response;
}

/**
 * Classify a completed gRPC-web body that is not a clean success. Output frames
 * make it accepted work; a typed status before any output is a definite refusal.
 * The executor body keeps its existing message and code; the gateway reads the
 * fixed classification through parseError.
 */
function decodedFailureResponse(decoded, upstreamHeaders) {
  const message = decoded.error || "Incomplete gRPC-web frame";
  if (decoded.output) return failureResponse(ACCEPTED_FAILURE, message, "upstream_error");
  const status = decoded.grpcStatus ?? headerGrpcStatus(upstreamHeaders);
  const typed = GRPC_TYPED_FAILURES[status];
  if (typed) return failureResponse(typed);
  return new Response(JSON.stringify({
    error: { message, type: "windsurf_error", code: "upstream_error" }
  }), { status: 502, headers: { "Content-Type": "application/json" } });
}

/**
 * Read the whole gRPC-web body. Cancellation stops waiting and cancels the
 * upstream body. A body that fails after the 200 was accepted is uncertain work.
 */
async function readUpstreamBytes(upstream, signal) {
  const reader = upstream.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(0), failed: false };
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      if (value?.length) chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (signal?.aborted) throw requestAbortError(signal.reason);
    if (error?.name === "AbortError") throw error;
    return { bytes: null, failed: true };
  }
  const total = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, failed: false };
}

function parseGrpcWebFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset + 5 <= buf.length) {
    const flag = buf[offset];
    const len =
    buf[offset + 1] << 24 |
    buf[offset + 2] << 16 |
    buf[offset + 3] << 8 |
    buf[offset + 4];
    if (len < 0 || offset + 5 + len > buf.length) break;
    frames.push({ flag, payload: buf.slice(offset + 5, offset + 5 + len) });
    offset += 5 + len;
  }
  return { frames, incomplete: offset < buf.length };
}

function mergeExtraHeaders(headers, upstreamExtraHeaders) {
  if (!upstreamExtraHeaders || !isObject(upstreamExtraHeaders)) return headers;
  for (const [key, value] of Object.entries(upstreamExtraHeaders)) {
    if (value == null || !isValidHttpHeaderName(key)) continue;
    headers[key] = String(value);
  }
  return headers;
}

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export class WindsurfExecutor extends BaseExecutor {
  constructor() {
    super("windsurf", PROVIDERS.windsurf || { baseUrl: WS_CHAT_URL });
  }

  buildUrl() {
    return WS_CHAT_URL;
  }

  buildHeaders(credentials = {}) {
    const token = credentials.accessToken || credentials.apiKey || "";
    return {
      "Content-Type": "application/grpc-web+proto",
      Accept: "application/grpc-web+proto",
      ...(token ? { Authorization: `Bearer ${token}` } : null),
      "User-Agent": `windsurf/${WS_IDE_VERSION}`,
      "X-Grpc-Web": "1"
    };
  }

  transformRequest() {
    return null;
  }

  // The gateway extracts bounded rate-limit evidence from the response itself.
  // Never pass arbitrary provider text into public errors or request logs.
  // Executor-built failures carry a fixed classification instead.
  parseError(response) {
    const failure = executorFailures.get(response);
    if (failure) {
      return {
        status: failure.status,
        message: failure.message,
        errorBody: { error: { message: failure.message, type: failure.type, code: failure.code } }
      };
    }
    return { status: response.status, message: "Windsurf upstream error" };
  }

  /** Imported Windsurf tokens carry no refresh token; a rejected one needs a new import. */
  async refreshCredentials() {
    return null;
  }

  /** chatCore hook: a refresh cannot answer a rejected import token, so never resend it. */
  shouldRefreshAfterAuthFailure() {
    return false;
  }

  async execute(input) {
    if (input.signal?.aborted) throw requestAbortError(input.signal.reason);
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    return withBillableDispatch(sender, (billed) => this.runChat(input, sender, billed));
  }

  async runChat({
    model = "swe-1",
    body = {},
    stream = true,
    credentials = {},
    signal,
    log,
    proxyOptions = null,
    upstreamExtraHeaders
  }, sender, billed) {
    const apiKey = credentials.accessToken || credentials.apiKey || "";
    const wsModel = resolveWsModelId(model);
    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];

    if (hasToolCalling(rawMessages, body?.tools, body?.functions, body?.function_call)) {
      return { response: toolCallingNotSupportedResponse(), url: this.buildUrl(), headers: this.buildHeaders(credentials), transformedBody: null, isClientError: true };
    }

    if (hasUnsupportedMedia(rawMessages)) {
      return { response: mediaNotSupportedResponse(), url: this.buildUrl(), headers: this.buildHeaders(credentials), transformedBody: null, isClientError: true };
    }

    const wsMessages = openAIMessagesToWs(rawMessages);
    if (wsMessages.length === 0) wsMessages.push({ role: "user", content: "" });

    const protoPayload = buildGetChatMessageRequest(apiKey, wsModel, wsMessages);
    const framedPayload = grpcWebFrame(protoPayload);
    const url = this.buildUrl();
    const headers = mergeExtraHeaders(this.buildHeaders(credentials), upstreamExtraHeaders);

    log?.info?.("WS", `Windsurf -> ${wsModel} (${wsMessages.length} messages)`);

    const upstream = billed(await sender.sendRequest(url, {
      method: "POST",
      headers,
      body: framedPayload,
      signal
    }, proxyOptions));

    if (!upstream.ok) {
      return { response: upstream, url, headers, transformedBody: null };
    }

    const read = await readUpstreamBytes(upstream, signal);
    if (read.failed) {
      return { response: failureResponse(ACCEPTED_FAILURE, "Windsurf response body failed", "upstream_error"), url, headers, transformedBody: null };
    }
    const response = stream === false ?
    await this.transformToJSON(upstream, model, read.bytes) :
    await this.transformToSSE(upstream, model, read.bytes);

    return {
      response,
      url,
      headers,
      transformedBody: null,
      // The executor checked the gRPC OK trailer before building a success.
      ...(response.ok ? { terminalProvenance: "validated" } : null)
    };
  }

  async transformToJSON(upstream, model, bytes = null) {
    const responseId = `chatcmpl-ws-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const decoded = decodeGrpcWebCompletion(bytes ?? new Uint8Array(await upstream.arrayBuffer()));
    const {
      ok,
      error,
      contentParts,
      promptTokens,
      completionTokens
    } = decoded;

    if (!ok || error) return decodedFailureResponse(decoded, upstream.headers);

    const content = contentParts.join("");

    const json = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop"
      }]
    };
    if (promptTokens > 0 || completionTokens > 0) {
      json.usage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      };
    }

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  async transformToSSE(upstream, model, bytes = null) {
    const responseId = `chatcmpl-ws-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const decoded = decodeGrpcWebCompletion(bytes ?? new Uint8Array(await upstream.arrayBuffer()));
    const {
      ok,
      error,
      contentParts,
      promptTokens,
      completionTokens
    } = decoded;

    if (!ok || error) return decodedFailureResponse(decoded, upstream.headers);

    const sseStream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const emit = (text) => controller.enqueue(enc.encode(text));

        emit(sseChunk({
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]
        }));

        for (const text of contentParts) {
          emit(sseChunk({
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
          }));
        }

        const finishPayload = {
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
        };
        if (promptTokens > 0 || completionTokens > 0) {
          finishPayload.usage = {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
          };
        }
        emit(sseChunk(finishPayload));
        emit("data: [DONE]\n\n");
        controller.close();
      }
    });

    return new Response(sseStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      }
    });
  }
}

export const __windsurfInternals = {
  MODEL_ALIAS_MAP,
  buildGetChatMessageRequest,
  concatBytes,
  decodeCompletionChunk,
  encodeField,
  encodeString,
  encodeVarint,
  grpcWebFrame,
  openAIMessagesToWs,
  parseGrpcWebFrames,
  resolveWsModelId
};
