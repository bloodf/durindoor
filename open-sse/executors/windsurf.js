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
import { proxyAwareFetch } from "../utils/proxyFetch.js";

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
  "glm-5.1": "glm-5-1",
};

const TEXT_ENC = new TextEncoder();
const TEXT_DEC = new TextDecoder();

function resolveWsModelId(model) {
  return MODEL_ALIAS_MAP[model] ?? model;
}

function encodeVarint(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
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
  return concatBytes([encodeVarint((fieldNum << 3) | 2), encodeVarint(payload.length), payload]);
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
    encodeString(6, WS_LOCALE),
  ]);
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
    encodeField(3, buildModelOrAlias(model)),
  ];
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
        message: decodeStringField(payload, 1) || "unknown windsurf error",
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
    if (typeof m?.content === "string") {
      content = m.content;
    } else if (Array.isArray(m?.content)) {
      for (const part of m.content) {
        if (part && typeof part === "object" && part.type === "text") {
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
        if (part && typeof part === "object" && part.type && part.type !== "text") {
          return true;
        }
      }
    }
  }
  return false;
}

function toolCallingNotSupportedResponse() {
  return new Response(JSON.stringify({
    error: { message: "Tool calling is not supported for Windsurf", type: "invalid_request_error", code: "unsupported_parameter" },
  }), { status: 400, headers: { "Content-Type": "application/json" } });
}

function mediaNotSupportedResponse() {
  return new Response(JSON.stringify({
    error: { message: "Media files are not supported for Windsurf", type: "invalid_request_error", code: "unsupported_parameter" },
  }), { status: 400, headers: { "Content-Type": "application/json" } });
}

function decodeGrpcWebCompletion(bytes) {
  const result = {
    ok: false,
    error: null,
    contentParts: [],
    promptTokens: 0,
    completionTokens: 0,
  };
  const parsed = parseGrpcWebFrames(bytes);
  if (parsed.incomplete) {
    result.error = "Incomplete gRPC-web frame";
    return result;
  }
  for (const frame of parsed.frames) {
    if (frame.flag === 0x80) {
      const trailer = TEXT_DEC.decode(frame.payload);
      const statusMatch = /grpc-status:\s*(\d+)/i.exec(trailer);
      if (statusMatch) {
        if (statusMatch[1] === "0") {
          result.ok = true;
        } else {
          const msgMatch = /grpc-message:\s*(.+)/i.exec(trailer);
          result.error = msgMatch
            ? decodeURIComponent(msgMatch[1].trim())
            : `gRPC status ${statusMatch[1]}`;
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
      result.error = chunk.message;
    }
  }
  if (!result.ok && !result.error) {
    result.error = "Missing gRPC OK trailer";
  }
  return result;
}

function parseGrpcWebFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset + 5 <= buf.length) {
    const flag = buf[offset];
    const len =
      (buf[offset + 1] << 24) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 8) |
      buf[offset + 4];
    if (len < 0 || offset + 5 + len > buf.length) break;
    frames.push({ flag, payload: buf.slice(offset + 5, offset + 5 + len) });
    offset += 5 + len;
  }
  return { frames, incomplete: offset < buf.length };
}

function mergeExtraHeaders(headers, upstreamExtraHeaders) {
  if (!upstreamExtraHeaders || typeof upstreamExtraHeaders !== "object") return headers;
  for (const [key, value] of Object.entries(upstreamExtraHeaders)) {
    if (value == null) continue;
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "User-Agent": `windsurf/${WS_IDE_VERSION}`,
      "X-Grpc-Web": "1",
    };
  }

  transformRequest() {
    return null;
  }

  async execute({
    model = "swe-1",
    body = {},
    stream = true,
    credentials = {},
    signal,
    log,
    proxyOptions = null,
    upstreamExtraHeaders,
  } = {}) {
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

    const upstream = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: framedPayload,
      signal,
    }, proxyOptions);

    if (!upstream.ok) {
      return { response: upstream, url, headers, transformedBody: null };
    }

    const response = stream === false
      ? await this.transformToJSON(upstream, model)
      : await this.transformToSSE(upstream, model);

    return {
      response,
      url,
      headers,
      transformedBody: null,
    };
  }

  async transformToJSON(upstream, model) {
    const responseId = `chatcmpl-ws-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const {
      ok,
      error,
      contentParts,
      promptTokens,
      completionTokens,
    } = decodeGrpcWebCompletion(bytes);

    if (!ok || error) {
      return new Response(JSON.stringify({
        error: { message: error || "Incomplete gRPC-web frame", type: "windsurf_error", code: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    const content = contentParts.join("");

    const json = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      }],
    };
    if (promptTokens > 0 || completionTokens > 0) {
      json.usage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      };
    }

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  async transformToSSE(upstream, model) {
    const responseId = `chatcmpl-ws-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const {
      ok,
      error,
      contentParts,
      promptTokens,
      completionTokens,
    } = decodeGrpcWebCompletion(bytes);

    if (!ok || error) {
      return new Response(JSON.stringify({
        error: { message: error || "Incomplete gRPC-web frame", type: "windsurf_error", code: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    const sseStream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const emit = (text) => controller.enqueue(enc.encode(text));

        emit(sseChunk({
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
        }));

        for (const text of contentParts) {
          emit(sseChunk({
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          }));
        }

        const finishPayload = {
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        if (promptTokens > 0 || completionTokens > 0) {
          finishPayload.usage = {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          };
        }
        emit(sseChunk(finishPayload));
        emit("data: [DONE]\n\n");
        controller.close();
      },
    });

    return new Response(sseStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
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
  resolveWsModelId,
};
