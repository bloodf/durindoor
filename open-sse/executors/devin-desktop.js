// Devin Desktop executor (staged; not in open-sse/executors/index.js yet).
//
// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/executors/devin-desktop.ts, open-sse/services/devinDesktopModels.ts and
// src/app/api/providers/[id]/models/devinDesktopDiscovery.ts (MIT).
//
// Translates an OpenAI chat request into the Devin Desktop Connect-protobuf
// GetChatMessage stream and the stream back into OpenAI chat chunks. The upstream
// still identifies this client as Windsurf; that compatibility identity is private to
// this transport.
//
// Per request: GetUserJwt (the session token authenticates through Metadata.api_key and
// returns a short-lived user JWT) -> GetChatMessage with both in Metadata -> Connect
// frames -> SSE. The session token never refreshes; the JWT is minted per request.
//
// Safety posture:
//  - Dispatch is off unless the connection sets
//    `providerSpecificData.enableSessionDispatch === true`. Each connection opts in alone.
//  - The credential-derived `custom_api_server_url` is decoded but never followed (SSRF).
//  - Errors carry status and an allowlisted code only, never an upstream body.
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { BaseExecutor } from "./base.js";
import { errorResponse, sanitizeErrorMessage, buildErrorBody } from "../utils/error.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { credentialFetch } from "../utils/credentialFetch.js";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

export const DEVIN_DESKTOP_BASE_URL = "https://server.codeium.com";
export const DEVIN_DESKTOP_CHAT_URL = `${DEVIN_DESKTOP_BASE_URL}/exa.api_server_pb.ApiServerService/GetChatMessage`;
export const DEVIN_DESKTOP_AUTH_URL = `${DEVIN_DESKTOP_BASE_URL}/exa.auth_pb.AuthService/GetUserJwt`;
export const DEVIN_DESKTOP_MODEL_CONFIG_URL = `${DEVIN_DESKTOP_BASE_URL}/exa.api_server_pb.ApiServerService/GetCliModelConfigs`;
export const DEVIN_DESKTOP_OPT_IN_KEY = "enableSessionDispatch";

const IDE_NAME = "windsurf";
const VERIFIED_VERSION = "3.6.27";
const DEFAULT_EXTENSION_VERSION = "1.48.2";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const LOCALE = "en-US";
const COMPRESSED_FLAG = 0x01;
const END_STREAM_FLAG = 0x02;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_AUTH_RESPONSE_BYTES = 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const DISCOVERY_TIMEOUT_MS = 5000;
const DEFAULT_CONTEXT_WINDOW = 200000;
const DEFAULT_MAX_OUTPUT_TOKENS = 64000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function resolveDevinDesktopVersion() {
  const override = process.env.DEVIN_DESKTOP_VERSION?.trim() ?? "";
  return VERSION_PATTERN.test(override) ? override : VERIFIED_VERSION;
}

export function resolveDevinDesktopExtensionVersion() {
  const override = process.env.DEVIN_DESKTOP_EXTENSION_VERSION?.trim() ?? "";
  return VERSION_PATTERN.test(override) ? override : DEFAULT_EXTENSION_VERSION;
}

export function isDevinDesktopDispatchEnabled(credentials) {
  return credentials?.providerSpecificData?.[DEVIN_DESKTOP_OPT_IN_KEY] === true;
}

// ---- protobuf wire helpers -------------------------------------------------

function encodeVarint(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid protobuf varint");
  const bytes = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return Uint8Array.from(bytes);
}

function concatBytes(arrays) {
  const result = new Uint8Array(arrays.reduce((length, bytes) => length + bytes.length, 0));
  let offset = 0;
  for (const bytes of arrays) {
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
}

const bodyBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const encodeField = (field, payload) => concatBytes([encodeVarint((field << 3) | 2), encodeVarint(payload.length), payload]);
const encodeString = (field, value) => (value ? encodeField(field, encoder.encode(value)) : new Uint8Array(0));
const encodeVarintField = (field, value) => (value === 0 ? new Uint8Array(0) : concatBytes([encodeVarint(field << 3), encodeVarint(value)]));

function encodeMetadata({ apiKey, sessionId, userJwt, ideVersion, extensionVersion }) {
  return concatBytes([
    encodeString(1, IDE_NAME),
    encodeString(2, extensionVersion ?? resolveDevinDesktopExtensionVersion()),
    encodeString(3, apiKey),
    encodeString(4, LOCALE),
    encodeString(7, ideVersion ?? resolveDevinDesktopVersion()),
    encodeString(10, sessionId),
    encodeString(12, IDE_NAME),
    encodeString(21, userJwt ?? ""),
  ]);
}

/** Unary GetUserJwtRequest (field 1 = Metadata), no envelope. Also the discovery request body. */
export function encodeDevinDesktopAuthRequest(input) {
  return encodeField(1, encodeMetadata(input));
}

/** Verified exa.api_server_pb.GetChatMessageRequest wire schema. */
export function encodeDevinDesktopRequest(input) {
  const fields = [encodeField(1, encodeMetadata(input)), encodeString(2, input.systemPrompt)];
  for (const prompt of input.prompts) {
    const parts = [encodeString(1, prompt.messageId), encodeVarintField(2, prompt.source), encodeString(3, prompt.prompt)];
    for (const call of prompt.toolCalls ?? []) {
      parts.push(encodeField(6, concatBytes([encodeString(1, call.id), encodeString(2, call.name), encodeString(3, call.argumentsJson)])));
    }
    parts.push(encodeString(7, prompt.toolCallId ?? ""));
    fields.push(encodeField(3, concatBytes(parts)));
  }
  fields.push(encodeVarintField(7, 5)); // CHAT_MESSAGE_REQUEST_TYPE_CASCADE
  for (const tool of input.tools ?? []) {
    fields.push(encodeField(10, concatBytes([
      encodeString(1, tool.name), encodeString(2, tool.description), encodeString(3, tool.jsonSchemaString), encodeVarintField(12, tool.strict ? 1 : 0),
    ])));
  }
  if (input.disableParallelToolCalls) fields.push(encodeVarintField(11, 1));
  if (input.toolChoice) {
    fields.push(encodeField(12, "optionName" in input.toolChoice ? encodeString(1, input.toolChoice.optionName) : encodeString(2, input.toolChoice.toolName)));
  }
  fields.push(encodeString(14, input.model), encodeString(16, input.cascadeId), encodeString(21, input.model));
  return concatBytes(fields);
}

/** Connect streaming envelope: flags byte plus a big-endian uint32 length. */
export function encodeDevinConnectEnvelope(payload, flags = 0) {
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = flags;
  new DataView(frame.buffer).setUint32(1, payload.length, false);
  frame.set(payload, 5);
  return frame;
}

function readVarint(bytes, start) {
  let value = 0;
  let multiplier = 1;
  let offset = start;
  for (let count = 0; count < 10 && offset < bytes.length; count++) {
    const byte = bytes[offset++];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new Error("protobuf varint exceeds safe range");
    if ((byte & 0x80) === 0) return [value, offset];
    multiplier *= 0x80;
  }
  throw new Error("truncated protobuf varint");
}

/** Bounded decoder for untrusted protobuf: throws on anything malformed. */
export function decodeProtoFields(bytes) {
  const fields = [];
  let offset = 0;
  while (offset < bytes.length) {
    let tag;
    [tag, offset] = readVarint(bytes, offset);
    const number = Math.floor(tag / 8);
    const wire = tag & 0x07;
    if (number === 0) throw new Error("invalid protobuf field number");
    if (wire === 0) {
      let value;
      [value, offset] = readVarint(bytes, offset);
      fields.push({ number, wire, value });
    } else if (wire === 2) {
      let length;
      [length, offset] = readVarint(bytes, offset);
      if (length > bytes.length - offset) throw new Error("truncated protobuf field");
      fields.push({ number, wire, value: bytes.slice(offset, offset + length) });
      offset += length;
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (offset + size > bytes.length) throw new Error("truncated protobuf fixed field");
      fields.push({ number, wire, value: bytes.slice(offset, offset + size) });
      offset += size;
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
  }
  return fields;
}

const text = (field) => (field?.value instanceof Uint8Array ? decoder.decode(field.value) : "");
const num = (field) => (Number.isFinite(field?.value) ? field.value : 0);

// ---- OpenAI -> Devin -------------------------------------------------------

function messageText(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (isRecord(part) && part.type === "text" ? String(part.text ?? "") : "")).join("");
}

function convertMessages(messages) {
  const system = [];
  const prompts = [];
  for (const message of messages) {
    const role = String(message?.role || "user");
    const prompt = messageText(message?.content);
    if (role === "system" || role === "developer") {
      if (prompt) system.push(prompt);
      continue;
    }
    const source = role === "assistant" ? 2 : role === "tool" ? 4 : 1;
    const entry = { messageId: source === 2 ? `bot-${randomUUID()}` : randomUUID(), source, prompt };
    if (source === 2) {
      entry.toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
        .filter((call) => call?.type === "function" && isString(call.id) && isString(call.function?.name) && isString(call.function?.arguments))
        .map((call) => ({ id: call.id, name: call.function.name, argumentsJson: call.function.arguments }));
    }
    if (source === 4 && message.tool_call_id) entry.toolCallId = message.tool_call_id;
    prompts.push(entry);
  }
  return { systemPrompt: system.join("\n\n"), prompts };
}

function convertTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .filter((tool) => tool?.type === "function" && isString(tool.function?.name))
    .map((tool) => ({
      name: tool.function.name,
      description: isString(tool.function.description) ? tool.function.description : "",
      jsonSchemaString: JSON.stringify(tool.function.parameters ?? {}),
      strict: tool.function.strict === true,
    }));
}

function convertToolChoice(choice) {
  if (choice === "auto" || choice === "none" || choice === "required") return { optionName: choice };
  const name = isRecord(choice) && choice.type === "function" ? choice.function?.name : null;
  return isString(name) && name ? { toolName: name } : undefined;
}

// ---- Devin -> OpenAI -------------------------------------------------------

function decodeUsage(bytes) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
  for (const field of decodeProtoFields(bytes)) {
    if (field.wire !== 0) continue;
    if (field.number === 2) usage.inputTokens = field.value;
    else if (field.number === 3) usage.outputTokens = field.value;
    else if (field.number === 4) usage.cacheWriteTokens = field.value;
    else if (field.number === 5) usage.cacheReadTokens = field.value;
  }
  return usage;
}

function decodeToolCall(bytes) {
  const call = { id: "", name: "", arguments: "" };
  for (const field of decodeProtoFields(bytes)) {
    if (field.wire !== 2) continue;
    if (field.number === 1) call.id = text(field);
    else if (field.number === 2) call.name = text(field);
    else if (field.number === 3) call.arguments += text(field);
  }
  return call;
}

function decodeChatMessageResponse(bytes) {
  const result = { text: "", thinking: "", stopReason: 0, usage: null, toolCalls: [] };
  for (const field of decodeProtoFields(bytes)) {
    if (field.wire === 2 && field.number === 3) result.text += text(field);
    else if (field.wire === 0 && field.number === 5) result.stopReason = field.value;
    else if (field.wire === 2 && field.number === 6) {
      // Argument fragments arrive as id-less submessages; keep them as continuation deltas.
      const call = decodeToolCall(field.value);
      if (call.id || call.name || call.arguments) result.toolCalls.push(call);
    } else if (field.wire === 2 && field.number === 7) result.usage = decodeUsage(field.value);
    else if (field.wire === 2 && field.number === 9) result.thinking += text(field);
  }
  return result;
}

function decodeAuthResponse(bytes) {
  // Field 2 (custom_api_server_url) is deliberately ignored: following a
  // credential-derived URL would be an SSRF path.
  return { userJwt: decodeProtoFields(bytes).filter((field) => field.wire === 2 && field.number === 1).map(text).at(-1) ?? "" };
}

function parseConnectError(payload) {
  let parsed;
  try {
    parsed = JSON.parse(decoder.decode(payload).trim() || "{}");
  } catch {
    return { code: "invalid_trailer", message: "Invalid Devin Desktop Connect trailer" };
  }
  if (!isRecord(parsed) || !("error" in parsed)) return null;
  const error = parsed.error;
  if (!isRecord(error)) return { code: "upstream_error", message: "Devin Desktop Connect stream failed" };
  return { code: isString(error.code) ? error.code : "upstream_error", message: isString(error.message) ? error.message : "Connect stream failed" };
}

function finishReason(stopReason, hasToolCalls) {
  if (hasToolCalls || stopReason === 10) return "tool_calls";
  if (stopReason === 3) return "length";
  if (stopReason === 11) return "content_filter";
  return "stop";
}

// ---- error mapping ---------------------------------------------------------

const CONNECT_CODE_STATUS = {
  unauthenticated: 401,
  permission_denied: 403,
  resource_exhausted: 429,
  invalid_argument: 400,
  failed_precondition: 400,
  not_found: 404,
  deadline_exceeded: 504,
  unavailable: 503,
};

/** Map an HTTP status or Connect error code to a gateway error. Never carries an upstream body. */
export function classifyDevinDesktopError(status, connectCode) {
  const resolved = CONNECT_CODE_STATUS[connectCode] ?? status;
  if (resolved === 401) return { status: 401, type: "authentication_error", code: "invalid_session", message: "Devin Desktop session token was rejected or has expired. Sign in to Devin Desktop again; session tokens do not refresh." };
  if (resolved === 403) return { status: 403, type: "permission_error", code: "access_denied", message: "Devin Desktop denied access for this account or model. Check the plan, or sign in again." };
  if (resolved === 429) return { status: 429, type: "rate_limit_error", code: "quota_exceeded", message: "Devin Desktop quota or rate limit reached" };
  if (resolved >= 400 && resolved < 500) return { status: resolved, type: "invalid_request_error", code: `HTTP_${resolved}`, message: `Devin Desktop rejected the request (HTTP ${resolved})` };
  if (resolved === 503 || resolved === 504) return { status: resolved, type: "upstream_error", code: `HTTP_${resolved}`, message: `Devin Desktop is unavailable (HTTP ${resolved})` };
  return { status: 502, type: "upstream_error", code: "upstream_error", message: `Devin Desktop request failed (HTTP ${resolved})` };
}

function failure(mapped, url, body, retryAfter = null) {
  return {
    response: errorResponse(mapped.status, mapped.message, { type: mapped.type, code: mapped.code }, retryAfter),
    url,
    headers: {},
    transformedBody: body,
  };
}

function retryAfterSeconds(response) {
  const value = Number(response.headers?.get?.("retry-after"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function readBounded(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      total += value.length;
      if (total > limit) {
        await reader.cancel("response exceeds safety limit").catch(() => {});
        throw new Error("Devin Desktop response exceeds the safety limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatBytes(chunks);
}

/** The Connect error code of a non-2xx unary reply, when it carries one. */
async function connectCodeOf(response) {
  try {
    const parsed = JSON.parse(decoder.decode(await readBounded(response, MAX_ERROR_BODY_BYTES)));
    return isString(parsed?.code) ? parsed.code : null;
  } catch {
    return null;
  }
}

async function upstreamFailure(response, url, body) {
  const code = await connectCodeOf(response);
  return failure(classifyDevinDesktopError(response.status, code), url, body, retryAfterSeconds(response));
}

// ---- GetUserJwt ------------------------------------------------------------

const authHeaders = () => ({ "Content-Type": "application/proto", Accept: "*/*", "Connect-Protocol-Version": "1" });

/** Mint the short-lived user JWT from the session token. Throws a status-only error. */
async function mintUserJwt(fetcher, apiKey, sessionId, signal) {
  const response = await credentialFetch(fetcher, DEVIN_DESKTOP_AUTH_URL, {
    method: "POST",
    headers: authHeaders(),
    body: bodyBuffer(encodeDevinDesktopAuthRequest({ apiKey, sessionId })),
    signal,
  });
  if (!response.ok) {
    const error = new Error(`Devin Desktop authentication returned HTTP ${response.status}`);
    error.response = response;
    throw error;
  }
  const { userJwt } = decodeAuthResponse(await readBounded(response, MAX_AUTH_RESPONSE_BYTES));
  if (!userJwt) throw new Error("Devin Desktop authentication returned an empty user JWT");
  return userJwt;
}

/** Validate a session token by minting a user JWT with it. */
export async function validateDevinDesktopSession({ apiKey, fetcher = proxyAwareFetch, proxyOptions, signal } = {}) {
  const token = String(apiKey ?? "").trim();
  if (!token) return { valid: false, status: 401, error: "Devin Desktop session token is empty" };
  const send = (url, init) => credentialFetch((target, request) => fetcher(target, request, proxyOptions), url, init);
  try {
    await mintUserJwt(send, token, randomUUID(), signal ?? AbortSignal.timeout(10000));
    return { valid: true, status: 200 };
  } catch (error) {
    if (error.response) {
      const mapped = classifyDevinDesktopError(error.response.status, await connectCodeOf(error.response));
      return { valid: false, status: mapped.status, error: mapped.message };
    }
    return { valid: false, status: 502, error: error?.name === "AbortError" || error?.name === "TimeoutError" ? "Devin Desktop validation timed out" : "Devin Desktop validation failed" };
  }
}

// ---- model discovery -------------------------------------------------------

/** Decode a GetCliModelConfigs reply (plain or gzip). Fields: 1 name, 4 disabled, 5 vision, 18 context, 22 id. */
export function decodeDiscoveredDevinModels(payload) {
  const bytes = Uint8Array.from(payload);
  const body = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: MAX_FRAME_BYTES }) : bytes;
  const models = new Map();
  for (const entry of decodeProtoFields(body).filter((field) => field.number === 1 && field.wire === 2)) {
    const values = new Map(decodeProtoFields(entry.value).map((field) => [field.number, field]));
    const id = text(values.get(22)).trim();
    if (!id || num(values.get(4)) !== 0) continue;
    const contextLength = num(values.get(18)) || DEFAULT_CONTEXT_WINDOW;
    const discovered = { id, name: text(values.get(1)).trim() || id, contextLength, maxOutputTokens: Math.min(contextLength, DEFAULT_MAX_OUTPUT_TOKENS) };
    if (num(values.get(5))) discovered.supportsVision = true;
    models.set(id, discovered);
  }
  return [...models.values()];
}

/** The account's enabled models. Throws a status-only Error, so no upstream body reaches a log line. */
export async function discoverDevinDesktopModels(token, { signal, fetchImpl = fetch } = {}) {
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const response = await fetchImpl(DEVIN_DESKTOP_MODEL_CONFIG_URL, {
    method: "POST",
    headers: authHeaders(),
    body: bodyBuffer(encodeDevinDesktopAuthRequest({ apiKey: token, sessionId: randomUUID() })),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error(`Devin model discovery returned HTTP ${response.status}`);
  }
  return decodeDiscoveredDevinModels(await readBounded(response, MAX_FRAME_BYTES));
}

// ---- Connect stream -> OpenAI SSE -------------------------------------------

function frameLength(pending) {
  return new DataView(pending.buffer, pending.byteOffset + 1, 4).getUint32(0, false);
}

/** Buffer until the first Connect frame is complete (or the stream ends). */
async function peekFirstFrame(reader) {
  let pending = new Uint8Array(0);
  for (;;) {
    if (pending.length >= 5) {
      const length = frameLength(pending);
      if (length > MAX_FRAME_BYTES) throw new Error("Devin Desktop Connect frame exceeds the safety limit");
      if (pending.length >= 5 + length) return pending;
    }
    const { done, value } = await reader.read();
    if (value?.length) pending = concatBytes([pending, value]);
    if (done) return pending;
  }
}

function firstFrameError(pending) {
  if (pending.length < 5 || !(pending[0] & END_STREAM_FLAG)) return null;
  const length = frameLength(pending);
  if (pending.length < 5 + length) return null;
  let payload = pending.slice(5, 5 + length);
  try {
    if (pending[0] & COMPRESSED_FLAG) payload = gunzipSync(payload, { maxOutputLength: MAX_FRAME_BYTES });
  } catch {
    return null;
  }
  return parseConnectError(payload);
}

function transformToSSE(reader, initial, model) {
  const responseId = `chatcmpl-devin-desktop-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      const emitChunk = (delta, reason = null) => emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: reason }] });
      const emitError = (message, mapped = { status: 502, type: "devin_desktop_error", code: "upstream_error" }) => {
        emit(buildErrorBody(mapped.status, message, { type: mapped.type, code: mapped.code }));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      };

      let pending = initial;
      let roleEmitted = false;
      let stopReason = 0;
      let usage = null;
      let trailerError = null;
      let sawEndStream = false;
      const toolCallIndexes = new Map();
      let lastToolCallIndex;
      let orphanArguments = "";

      const handleFrame = (flags, payload) => {
        if ((flags & ~(COMPRESSED_FLAG | END_STREAM_FLAG)) !== 0) throw new Error("Invalid Devin Desktop Connect frame flags");
        const decoded = flags & COMPRESSED_FLAG ? gunzipSync(payload, { maxOutputLength: MAX_FRAME_BYTES }) : payload;
        if (flags & END_STREAM_FLAG) {
          if (sawEndStream) throw new Error("Duplicate Devin Desktop Connect end-stream frame");
          sawEndStream = true;
          trailerError = parseConnectError(decoded);
          return true;
        }
        const response = decodeChatMessageResponse(decoded);
        stopReason = response.stopReason || stopReason;
        usage = response.usage ?? usage;
        if ((response.thinking || response.text || response.toolCalls.length) && !roleEmitted) {
          emitChunk({ role: "assistant", content: "" });
          roleEmitted = true;
        }
        if (response.thinking) emitChunk({ reasoning_content: response.thinking });
        if (response.text) emitChunk({ content: response.text });
        for (const call of response.toolCalls) {
          // A fragment before any id'd call has nothing to continue: hold it for the first call.
          if (!call.id && lastToolCallIndex === undefined) {
            orphanArguments += call.arguments;
            continue;
          }
          const existing = call.id ? toolCallIndexes.get(call.id) : lastToolCallIndex;
          const index = existing ?? toolCallIndexes.size;
          const first = Boolean(call.id) && existing === undefined;
          if (call.id) {
            if (first) toolCallIndexes.set(call.id, index);
            lastToolCallIndex = index;
          }
          const fn = {};
          if (call.name) fn.name = call.name;
          const args = first ? orphanArguments + call.arguments : call.arguments;
          if (first) orphanArguments = "";
          if (args) fn.arguments = args;
          const delta = { index, function: fn };
          if (first) Object.assign(delta, { id: call.id, type: "function" });
          emitChunk({ tool_calls: [delta] });
        }
        return false;
      };

      const drain = () => {
        let offset = 0;
        while (pending.length - offset >= 5) {
          const length = new DataView(pending.buffer, pending.byteOffset + offset + 1, 4).getUint32(0, false);
          if (length > MAX_FRAME_BYTES) throw new Error("Devin Desktop Connect frame exceeds the safety limit");
          if (pending.length - offset < 5 + length) break;
          const terminal = handleFrame(pending[offset], pending.slice(offset + 5, offset + 5 + length));
          offset += 5 + length;
          if (terminal) {
            if (pending.length !== offset) throw new Error("Data follows the Devin Desktop Connect end-stream frame");
            pending = new Uint8Array(0);
            return true;
          }
        }
        if (offset > 0) pending = pending.slice(offset);
        return false;
      };

      try {
        let finished = pending.length ? drain() : false;
        while (!finished) {
          const { done, value } = await reader.read();
          if (value?.length) {
            pending = pending.length ? concatBytes([pending, value]) : Uint8Array.from(value);
            finished = drain();
          }
          if (done) break;
        }
        if (finished) await reader.cancel("Devin Desktop Connect end-stream received").catch(() => {});
        if (pending.length !== 0) throw new Error("Truncated Devin Desktop Connect frame");
        if (!sawEndStream) throw new Error("Devin Desktop Connect stream ended without trailers");
        if (trailerError) {
          const mapped = classifyDevinDesktopError(502, trailerError.code);
          emitError(mapped.message, mapped);
          return;
        }
        const final = {
          id: responseId, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: {}, finish_reason: finishReason(stopReason, toolCallIndexes.size > 0) }],
        };
        if (usage) {
          final.usage = {
            prompt_tokens: usage.inputTokens,
            completion_tokens: usage.outputTokens,
            total_tokens: usage.inputTokens + usage.outputTokens,
            prompt_tokens_details: { cached_tokens: usage.cacheReadTokens },
            cache_write_tokens: usage.cacheWriteTokens,
          };
        }
        emit(final);
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        await reader.cancel("Devin Desktop Connect stream failed").catch(() => {});
        emitError(`Devin Desktop stream error: ${sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`);
      } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
        controller.close();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

// ---- executor ----------------------------------------------------------------

export class DevinDesktopExecutor extends BaseExecutor {
  constructor() {
    super("devin-desktop", { id: "devin-desktop", baseUrl: DEVIN_DESKTOP_CHAT_URL });
  }

  buildUrl() {
    return DEVIN_DESKTOP_CHAT_URL;
  }

  buildHeaders() {
    return {
      "Content-Type": "application/connect+proto",
      Accept: "application/connect+proto",
      "Connect-Protocol-Version": "1",
      "Connect-Accept-Encoding": "gzip",
      "User-Agent": `${IDE_NAME}/${resolveDevinDesktopVersion()}`,
    };
  }

  transformRequest() {
    return null;
  }

  /** Session tokens carry no refresh token; a rejected one needs a new sign-in. */
  async refreshCredentials() {
    return null;
  }

  needsRefresh() {
    return false;
  }

  /** chatCore hook: a rejected session token cannot be answered by a fresh one, so do not retry it. */
  shouldRefreshAfterAuthFailure() {
    return false;
  }

  async execute({ model, body, credentials, signal, log, proxyOptions }) {
    if (!isDevinDesktopDispatchEnabled(credentials)) {
      return failure(
        { status: 403, type: "permission_error", code: "devin_desktop_dispatch_disabled", message: `Devin Desktop dispatch is off for this connection. Set providerSpecificData.${DEVIN_DESKTOP_OPT_IN_KEY} to true to opt in.` },
        DEVIN_DESKTOP_CHAT_URL,
        body ?? null,
      );
    }
    const apiKey = String(credentials?.accessToken || credentials?.apiKey || "").trim();
    if (!apiKey) return failure(classifyDevinDesktopError(401), DEVIN_DESKTOP_CHAT_URL, body ?? null);

    const fetcher = (url, init) => credentialFetch((target, request) => proxyAwareFetch(target, request, proxyOptions), url, init);
    const request = isRecord(body) ? body : {};
    const converted = convertMessages(Array.isArray(request.messages) ? request.messages : []);
    if (converted.prompts.length === 0) converted.prompts.push({ messageId: randomUUID(), source: 1, prompt: "" });
    const sessionId = randomUUID();
    const cascadeId = isString(request.conversation_id) && request.conversation_id ? request.conversation_id : randomUUID();
    const upstreamModel = isString(model) && model ? model : String(request.model ?? "");

    let userJwt;
    try {
      userJwt = await mintUserJwt(fetcher, apiKey, sessionId, signal);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error.response) return upstreamFailure(error.response, DEVIN_DESKTOP_AUTH_URL, null);
      log?.warn?.("DEVIN", `Devin Desktop authentication failed: ${sanitizeErrorMessage(error?.message ?? String(error))}`);
      return failure({ status: 502, type: "upstream_error", code: "upstream_error", message: "Devin Desktop authentication failed" }, DEVIN_DESKTOP_AUTH_URL, null);
    }

    const protobuf = encodeDevinDesktopRequest({
      apiKey,
      userJwt,
      model: upstreamModel,
      systemPrompt: converted.systemPrompt,
      prompts: converted.prompts,
      sessionId,
      cascadeId,
      tools: convertTools(request.tools),
      disableParallelToolCalls: request.parallel_tool_calls === false,
      toolChoice: convertToolChoice(request.tool_choice),
    });
    log?.info?.("DEVIN", `Devin Desktop -> ${upstreamModel} (${converted.prompts.length} messages)`);

    let upstream;
    try {
      upstream = await fetcher(DEVIN_DESKTOP_CHAT_URL, {
        method: "POST",
        headers: this.buildHeaders(),
        body: bodyBuffer(encodeDevinConnectEnvelope(protobuf)),
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return failure({ status: 502, type: "upstream_error", code: "upstream_error", message: "Devin Desktop upstream connection failed" }, DEVIN_DESKTOP_CHAT_URL, null);
    }
    if (!upstream.ok) return upstreamFailure(upstream, DEVIN_DESKTOP_CHAT_URL, null);

    const reader = upstream.body?.getReader();
    if (!reader) return failure({ status: 502, type: "upstream_error", code: "upstream_error", message: "Devin Desktop response body is empty" }, DEVIN_DESKTOP_CHAT_URL, null);
    let initial;
    try {
      initial = await peekFirstFrame(reader);
    } catch (error) {
      await reader.cancel().catch(() => {});
      return failure({ status: 502, type: "upstream_error", code: "upstream_error", message: `Devin Desktop stream error: ${sanitizeErrorMessage(error?.message ?? String(error))}` }, DEVIN_DESKTOP_CHAT_URL, null);
    }
    // An error trailer before any content is a plain failure, so its credential or quota
    // meaning reaches the caller as a status instead of an error event in a 200 stream.
    const early = firstFrameError(initial);
    if (early) {
      await reader.cancel().catch(() => {});
      return failure(classifyDevinDesktopError(502, early.code), DEVIN_DESKTOP_CHAT_URL, null);
    }
    return {
      response: transformToSSE(reader, initial, upstreamModel),
      url: DEVIN_DESKTOP_CHAT_URL,
      headers: { "Content-Type": "application/connect+proto", Authorization: "[REDACTED]" },
      transformedBody: null,
    };
  }
}

export default DevinDesktopExecutor;
