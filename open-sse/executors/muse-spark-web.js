// Ported from OmniRoute 4265bb2ad5477450a07d3a43ea33a62c6c874878 (MIT).
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import WebSocket from "ws";
import { BaseExecutor } from "./base.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { UnsupportedOmniRouteWebSessionExecutor } from "./unsupported-websession.js";
import { normalizeSessionCookieHeader, normalizeSessionCookieHeaders } from "./websession-utils.js";
import { prepareToolMessages, buildToolAwareResult } from "../translator/webTools.js";
import { sanitizeErrorMessage } from "../utils/error.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { isRecord } from "./muse-spark-web/response-parser.js";
import {
  _fetchFreshAccessTokenDispatch
} from "./muse-spark-web/fresh-access-token.js";
import {
  META_WS_CHAT_TEMPLATE_B64,
  META_WS_HOME_TEMPLATE_B64
} from "./muse-spark-web/ws-templates.js";
import { buildWsPromptFrame, writeU24Le } from "./muse-spark-web/ws-frame.js";
import {
  __fetchFreshAccessTokenForTesting,
  __resetMuseSparkTokenCacheForTesting,
  __setMuseSparkBrowserPoolForTesting,
  __setMuseSparkFreshTokenFetcherForTesting
} from "./muse-spark-web/fresh-access-token.js";
import { buildWsPromptFrame as buildWsPromptFrame2, parseProtoFields } from "./muse-spark-web/ws-frame.js";
const META_AI_GRAPHQL_API = "https://www.meta.ai/api/graphql";
const META_AI_DEFAULT_COOKIE = "ecto_1_sess";
const META_AI_WARMUP_DOC_ID = "e7f802582dbfed8e181b012e010993eb";
const META_AI_MODE_SWITCH_DOC_ID = "c32bbe999c48e64e855dc63177d5153f";
const META_WS_APP_ID = "1522763855472543";
const META_WS_APP_VERSION = "1.0.0";
const META_WS_AUTHTYPE = "15:0";
const META_WS_DGW_VERSION = "5";
const META_WS_DGW_UUID = "0";
const META_WS_TIER = "prod";
const META_WS_INTRO_FRAME_TYPE = 15;
const META_AI_ROOT_BRANCH_PATH = "0";
const META_AI_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MODEL_MAP = {
  "muse-spark": { mode: "think_fast", isThinking: false },
  "muse-spark-thinking": { mode: "think_hard", isThinking: true },
  "muse-spark-contemplating": { mode: "think_hard", isThinking: true }
};
function extractMessageText(content) {
  if (isString(content)) {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((part) => {
    if (!isRecord(part)) return "";
    if (part.type === "text" && isString(part.text)) {
      return part.text;
    }
    if (part.type === "input_text" && isString(part.text)) {
      return part.text;
    }
    return "";
  }).filter((part) => part.trim().length > 0).join("\n").trim();
}
function parseOpenAIMessages(messages) {
  const extracted = [];
  for (const message of messages) {
    let role = String(message.role || "user");
    if (role === "developer") role = "system";
    const content = extractMessageText(message.content);
    if (!content) continue;
    extracted.push({ role, content });
  }
  if (extracted.length === 0) {
    return {
      foldedPrompt: "",
      latestUserContent: "",
      lastAssistantIndex: -1,
      normalized: []
    };
  }
  let lastUserIndex = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  let lastAssistantIndex = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  const foldedPrompt = extracted.map((message, index) => {
    if (index === lastUserIndex) {
      return message.content;
    }
    return `${message.role}: ${message.content}`;
  }).join("\n\n").trim();
  const latestUserContent = lastUserIndex >= 0 ? extracted[lastUserIndex].content : "";
  return { foldedPrompt, latestUserContent, lastAssistantIndex, normalized: extracted };
}
function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}
function encodeBase62(value, padLength) {
  let remaining = value;
  let encoded = "";
  while (remaining > 0n) {
    encoded = BASE62_ALPHABET[Number(remaining % 62n)] + encoded;
    remaining /= 62n;
  }
  return encoded.padStart(padLength, "0");
}
function decodeBase62(value) {
  let decoded = 0n;
  for (const char of value) {
    const index = BASE62_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`Invalid base62 character: ${char}`);
    }
    decoded = decoded * 62n + BigInt(index);
  }
  return decoded;
}
function randomBigInt(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let result = 0n;
  for (const byte of bytes) {
    result = result << 8n | BigInt(byte);
  }
  return result;
}
function generateMetaConversationId() {
  const timestamp = BigInt(Date.now()) & (1n << 44n) - 1n;
  const random = randomBigInt(8) & (1n << 64n) - 1n;
  const packed = timestamp << 64n | random;
  return `c.${encodeBase62(packed, 19)}`;
}
function generateMetaEventId(conversationId) {
  if (!conversationId.startsWith("c.")) {
    return null;
  }
  try {
    const packedConversation = decodeBase62(conversationId.slice(2));
    const conversationRandom = packedConversation & (1n << 64n) - 1n;
    const timestamp = BigInt(Date.now()) & (1n << 44n) - 1n;
    const eventRandom = randomBigInt(4) & (1n << 32n) - 1n;
    const packedEvent = timestamp << 64n + 32n | conversationRandom << 32n | eventRandom;
    return `e.${encodeBase62(packedEvent, 25)}`;
  } catch {
    return null;
  }
}
function generateNumericMessageId() {
  return (BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1e3)) + (randomBigInt(2) & 0xfffn)).toString();
}
function normalizeMetaLocale() {
  const locale = globalThis.Intl !== undefined ? Intl.DateTimeFormat().resolvedOptions().locale || "en-US" : "en-US";
  return locale.replace(/-/g, "_");
}
function getMuseSparkModelInfo(model) {
  return MODEL_MAP[model] || MODEL_MAP["muse-spark"];
}
const MUSE_CONV_CACHE_MAX = 5e3;
const MUSE_CONV_CACHE_TTL_MS = 30 * 60 * 1e3;
const conversationCache = /* @__PURE__ */ new Map();
function canonicalizeNormalizedHistory(messages) {
  return messages.map((m) => `${m.role}${m.content}`).join("");
}
function makeConversationCacheKey(connectionId, model, normalizedPrefix) {
  return createHash("sha256").update(`${connectionId}${model}${canonicalizeNormalizedHistory(normalizedPrefix)}`).digest("hex");
}
function lookupCachedConversation(key) {
  const entry = conversationCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    conversationCache.delete(key);
    return null;
  }
  return entry;
}
function rememberConversation(key, context) {
  if (conversationCache.size >= MUSE_CONV_CACHE_MAX && !conversationCache.has(key)) {
    const oldest = conversationCache.keys().next().value;
    if (oldest) conversationCache.delete(oldest);
  }
  conversationCache.set(key, {
    conversationId: context.conversationId,
    branchPath: context.branchPath,
    expiresAt: Date.now() + MUSE_CONV_CACHE_TTL_MS
  });
}
function __resetMuseSparkConversationCacheForTesting() {
  conversationCache.clear();
}
function buildMetaAiRequestBody(prompt, model, conversation) {
  const userUniqueMessageId = generateNumericMessageId();
  return {
    doc_id: META_AI_WARMUP_DOC_ID,
    variables: {
      assistantMessageId: crypto.randomUUID(),
      // `attachments` was removed from Meta's GraphQL schema (the
      // AttachmentInput type is gone), so sending it — even as null —
      // makes the server reject the persisted query with
      // `Unknown type "AttachmentInput"`. Omit it entirely; GraphQL
      // input fields are nullable-by-omission by default.
      clientLatitude: null,
      clientLongitude: null,
      clientTimezone: globalThis.Intl !== undefined ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
      clippyIp: null,
      content: prompt,
      conversationId: conversation.conversationId,
      conversationStarterId: null,
      currentBranchPath: conversation.branchPath,
      developerOverridesForMessage: null,
      devicePixelRatio: 1,
      entryPoint: "KADABRA__CHAT__UNIFIED_INPUT_BAR",
      imagineOperationRequest: null,
      isNewConversation: conversation.isNewConversation,
      mentions: null,
      mode: getMuseSparkModelInfo(model).mode,
      promptEditType: null,
      promptSessionId: crypto.randomUUID(),
      promptType: null,
      qplJoinId: null,
      requestedToolCall: null,
      // `rewriteOptions` was removed from Meta's GraphQL schema (the
      // RewriteOptionsInput type is gone), so sending it — even as null —
      // makes the server reject the persisted query with
      // `Unknown type "RewriteOptionsInput"`. Omit it entirely; GraphQL
      // input fields are nullable-by-omission by default.
      turnId: crypto.randomUUID(),
      userAgent: META_AI_USER_AGENT,
      userEventId: generateMetaEventId(conversation.conversationId),
      userLocale: normalizeMetaLocale(),
      userMessageId: crypto.randomUUID(),
      userUniqueMessageId
    }
  };
}
function sseChunk(data) {
  return `data: ${JSON.stringify(data)}

`;
}
function buildStreamingResponse(deltas, reasoningDeltas, model, id, created) {
  const encoder = new TextEncoder();
  return new ReadableStream(
    {
      start(controller) {
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant" },
                  finish_reason: null,
                  logprobs: null
                }
              ]
            })
          )
        );
        for (const delta of reasoningDeltas) {
          if (!delta) continue;
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: null,
                choices: [
                  {
                    index: 0,
                    delta: { reasoning_content: delta },
                    finish_reason: null,
                    logprobs: null
                  }
                ]
              })
            )
          );
        }
        for (const delta of deltas) {
          if (!delta) continue;
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: null,
                choices: [
                  {
                    index: 0,
                    delta: { content: delta },
                    finish_reason: null,
                    logprobs: null
                  }
                ]
              })
            )
          );
        }
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }]
            })
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
    { highWaterMark: 16384 }
  );
}
function buildNonStreamingResponse(content, reasoningContent, model, id, created) {
  const completionTokens = estimateTokens(content);
  const message = { role: "assistant", content };
  if (reasoningContent) {
    message.reasoning_content = reasoningContent;
  }
  return new Response(
    JSON.stringify({
      id,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          message,
          finish_reason: "stop",
          logprobs: null
        }
      ],
      usage: {
        prompt_tokens: completionTokens,
        completion_tokens: completionTokens,
        total_tokens: completionTokens * 2
      }
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}
function buildErrorResponse(status, message, code) {
  return new Response(
    JSON.stringify({
      error: {
        message: sanitizeErrorMessage(message),
        type: "upstream_error",
        code: code || undefined
      }
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}
function normalizeMetaAiCookieHeader(apiKey) {
  return normalizeSessionCookieHeader(apiKey, META_AI_DEFAULT_COOKIE);
}
function selectMetaAiCookieHeader(credentials) {
  const extraCookieValues = Array.isArray(credentials.providerSpecificData?.extraApiKeys) ? credentials.providerSpecificData.extraApiKeys.filter(
    (value) => isString(value) && value.trim().length > 0
  ) : [];
  const normalizedPool = normalizeSessionCookieHeaders(
    [credentials.apiKey || "", ...extraCookieValues],
    META_AI_DEFAULT_COOKIE
  );
  if (normalizedPool.length === 0) {
    return "";
  }
  if (normalizedPool.length === 1 || !credentials.connectionId) {
    return normalizedPool[0];
  }
  return normalizedPool[0];
}
function buildMetaAiHeaders(cookieHeader) {
  return {
    Accept: "text/event-stream",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    Origin: "https://www.meta.ai",
    Referer: "https://www.meta.ai/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": META_AI_USER_AGENT,
    "X-ASBD-ID": "129477",
    "X-FB-Friendly-Name": "useEctoSendMessageSubscription",
    "X-FB-Request-Analytics-Tags": "graphservice"
  };
}
function resultWithResponse(response, headers, transformedBody) {
  return {
    response,
    url: META_AI_GRAPHQL_API,
    headers,
    transformedBody
  };
}
function errorResult(status, message, code, headers, transformedBody) {
  return resultWithResponse(buildErrorResponse(status, message, code), headers, transformedBody);
}
function getOpenAiMessages(body) {
  const messages = body.messages;
  if (!messages || !Array.isArray(messages) || messages.length === 0) return null;
  return messages;
}
function buildWsIntroFrame(conversationId) {
  const payload = new TextEncoder().encode(
    JSON.stringify({
      "x-dgw-app-x-ecto-conversation-id": conversationId,
      "x-dgw-app-client-payload-type": "PROTO_INSIDE_JSON"
    })
  );
  const header = new Uint8Array(6);
  header[0] = META_WS_INTRO_FRAME_TYPE;
  header[1] = 0;
  header[2] = 0;
  writeU24Le(payload.length, header, 3);
  const result = new Uint8Array(header.length + payload.length);
  result.set(header);
  result.set(payload, header.length);
  return result;
}
function buildWsUrl(authorization, requestId) {
  const params = new URLSearchParams({
    "x-dgw-appid": META_WS_APP_ID,
    "x-dgw-appversion": META_WS_APP_VERSION,
    "x-dgw-authtype": META_WS_AUTHTYPE,
    "x-dgw-version": META_WS_DGW_VERSION,
    "x-dgw-uuid": META_WS_DGW_UUID,
    "x-dgw-tier": META_WS_TIER,
    Authorization: authorization,
    "x-dgw-app-origin": "meta.ai",
    "x-dgw-app-clippy-request-id": requestId,
    "x-dgw-app-clippy-async": "true"
  });
  return `wss://gateway.meta.ai/ws/clippy?${params.toString()}`;
}
function isGraphqlFailure(result) {
  return !result.ok;
}
async function graphqlPost(docId, variables, cookieHeader, label, signal, proxyOptions) {
  try {
    const response = await proxyAwareFetch(META_AI_GRAPHQL_API, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "multipart/mixed, application/json",
        Cookie: cookieHeader,
        "User-Agent": META_AI_USER_AGENT,
        Origin: "https://meta.ai"
      },
      body: JSON.stringify({ doc_id: docId, variables }),
      signal: signal ?? void 0,
      directFetch: (url, init) => globalThis.fetch(url, init)
    }, proxyOptions);
    if (!response.ok) return { ok: false, status: response.status, error: `${label} failed: HTTP ${response.status}` };
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      if (json && Array.isArray(json.errors) && json.errors.length > 0) {
        const msg = json.errors[0]?.message || "Unknown GraphQL error";
        return { ok: false, error: `${label} failed: ${msg}` };
      }
    } catch {
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `${label} fetch failed: ${sanitizeErrorMessage(
        err instanceof Error ? err.message : String(err)
      )}`
    };
  }
}
function parseWsResponseEvents(payload) {
  const events = [];
  let start = null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload[i];
    if (start === null) {
      if (ch === "{") {
        start = i;
        depth = 1;
        inString = false;
        escape = false;
      }
      continue;
    }
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== null) {
        try {
          events.push(JSON.parse(payload.slice(start, i + 1)));
        } catch {
        }
        start = null;
      }
    }
  }
  return events;
}
let WebSocketCtor = WebSocket;
function __setMuseSparkWebSocketForTesting(ctor) {
  const previous = WebSocketCtor;
  WebSocketCtor = ctor;
  return () => {
    WebSocketCtor = previous;
  };
}
async function wsChat(prompt, conversationId, authorization, cookieHeader, templateB64, signal) {
  const requestId = crypto.randomUUID();
  const wsUrl = buildWsUrl(authorization, requestId);
  return new Promise((resolve) => {
    const ws = new WebSocketCtor(wsUrl, {
      headers: {
        "User-Agent": META_AI_USER_AGENT,
        Origin: "https://meta.ai"
      },
      followRedirects: false
    });
    let settled = false;
    let accumulatedText = "";
    const contentDeltas = [];
    let timeout = null;
    let abortHandler = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
      try {
        ws.close();
      } catch {
      }
      resolve(result);
    };
    const fail = (error) => finish({ content: "", deltas: [], error });
    timeout = setTimeout(() => fail(`Meta AI WS timed out (readyState=${ws.readyState})`), 3e4);
    abortHandler = () => fail("Request aborted");
    signal?.addEventListener("abort", abortHandler, { once: true });
    ws.onopen = () => {
      ws.send(buildWsIntroFrame(conversationId));
      ws.send(buildWsPromptFrame(prompt, conversationId, { templateB64, requestId }));
    };
    ws.onmessage = (event) => {
      let raw = "";
      if (isString(event.data)) {
        raw = event.data;
      } else if (Buffer.isBuffer(event.data)) {
        raw = event.data.toString("utf-8");
      } else if (event.data instanceof ArrayBuffer || event.data instanceof Uint8Array) {
        raw = new TextDecoder().decode(event.data);
      }
      if (Buffer.isBuffer(event.data) && event.data[0] === 0x0e) return fail("Meta AI WebSocket rejected the request");
      if (!raw) return;
      const events = parseWsResponseEvents(raw);
      for (const evt of events) {
        if (evt.type === "full") {
          const sections = evt.response?.sections || [];
          for (const section of sections) {
            const text = section?.view_model?.primitive?.text || "";
            if (text && text !== accumulatedText) {
              const delta = accumulatedText ? text.slice(accumulatedText.length) || text : text;
              if (delta) contentDeltas.push(delta);
              accumulatedText = text;
            }
          }
        } else if (evt.type === "patch") {
          const operations = evt.operations || [];
          for (const op of operations) {
            if (op.op === "delta" && op.path === "/sections/0/view_model/primitive/text" && isString(op.value)) {
              contentDeltas.push(op.value);
              accumulatedText += op.value;
            }
          }
        }
      }
    };
    ws.on?.("unexpected-response", (_request, response) => fail(`Meta AI WebSocket HTTP ${response.statusCode}`));
    ws.onerror = () => fail("Meta AI WebSocket connection error");
    ws.onclose = (event) => {
      if (settled) return;
      if (event?.code && event.code !== 1000) return fail(`Meta AI WebSocket closed (${event.code})`);
      finish({ content: accumulatedText, deltas: contentDeltas });
    };
  });
}
function getContinuationCacheKey(parsedHistory, credentials, model) {
  if (parsedHistory.lastAssistantIndex < 0 || !credentials.connectionId || parsedHistory.latestUserContent.length === 0) {
    return null;
  }
  return makeConversationCacheKey(
    credentials.connectionId,
    model,
    parsedHistory.normalized.slice(0, parsedHistory.lastAssistantIndex + 1)
  );
}
function getConversationContext(cached) {
  if (!cached) {
    return {
      conversationId: generateMetaConversationId(),
      branchPath: META_AI_ROOT_BRANCH_PATH,
      isNewConversation: true
    };
  }
  return {
    conversationId: cached.conversationId,
    branchPath: cached.branchPath,
    isNewConversation: false
  };
}
function evictContinuationIfNeeded(cached, cacheKey) {
  if (cached && cacheKey) {
    conversationCache.delete(cacheKey);
  }
}
function rememberAssistantTurn(parsed, credentials, model, parsedHistory, conversationContext) {
  if (!parsed.content || !credentials.connectionId) return;
  const writePrefix = [
    ...parsedHistory.normalized,
    { role: "assistant", content: parsed.content }
  ];
  rememberConversation(makeConversationCacheKey(credentials.connectionId, model, writePrefix), {
    conversationId: conversationContext.conversationId,
    branchPath: conversationContext.branchPath
  });
}
async function buildSuccessResult(parsed, stream, model, headers, transformedBody, hasTools, requestedTools) {
  const id = `chatcmpl-meta-${crypto.randomUUID().slice(0, 12)}`;
  const created = Math.floor(Date.now() / 1e3);
  const deltas = parsed.deltas.length > 0 ? parsed.deltas : [parsed.content];
  const reasoningDeltas = parsed.reasoningDeltas;
  let response = stream ? new Response(buildStreamingResponse(deltas, reasoningDeltas, model, id, created), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no"
    }
  }) : buildNonStreamingResponse(parsed.content, parsed.reasoningContent, model, id, created);
  if (hasTools && !stream) {
    const bodyText = await response.text();
    try {
      const json = JSON.parse(bodyText);
      const rawContent = json?.choices?.[0]?.message?.content || "";
      const { content, toolCalls, finishReason } = buildToolAwareResult(
        rawContent,
        requestedTools,
        "muse"
      );
      if (toolCalls) {
        json.choices[0].message = { role: "assistant", content: null, tool_calls: toolCalls };
        json.choices[0].finish_reason = finishReason;
      } else {
        json.choices[0].message.content = content;
      }
      response = new Response(JSON.stringify(json), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch {
    }
  }
  return resultWithResponse(response, headers, transformedBody);
}
class MuseSparkWebExecutor extends BaseExecutor {
  constructor() {
    super("muse-spark-web", { id: "muse-spark-web", baseUrl: META_AI_GRAPHQL_API });
  }
  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    upstreamExtraHeaders,
    proxyOptions
  }) {
    if (credentials?.providerSpecificData?.enableSessionDispatch !== true) {
      return new UnsupportedOmniRouteWebSessionExecutor("muse-spark-web").execute({ credentials });
    }
    const bodyObj = body || {};
    const rawMessages = getOpenAiMessages(body);
    if (!rawMessages) {
      return errorResult(400, "Missing or empty messages array", "invalid_request", {}, body);
    }
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(
      bodyObj,
      rawMessages
    );
    const parsedHistory = parseOpenAIMessages(effectiveMessages);
    if (!parsedHistory.foldedPrompt) {
      return errorResult(400, "Empty query after processing messages", "invalid_request", {}, body);
    }
    let cookieHeader = selectMetaAiCookieHeader(credentials);
    if (!cookieHeader || !/(?:^|;\s*)ecto_1_sess=[^;]+/.test(cookieHeader)) return errorResult(401, "Re-import your ecto_1_sess session cookie.", "auth_error", {}, body);
    const freshToken = await _fetchFreshAccessTokenDispatch(cookieHeader, signal, credentials.connectionId, proxyOptions);
    if (!freshToken.ok) {
      const status = freshToken.status === 429 ? 429 : (freshToken.status === 401 || freshToken.status === 403 ? 401 : 502);
      return errorResult(status, status === 401 ? "Meta AI session expired; re-import your ecto_1_sess cookie." : "Meta AI token bootstrap failed", "meta_ai_auth_error", {}, body);
    }
    const authorization = freshToken.token;
    if (freshToken.updatedCookie) cookieHeader = freshToken.updatedCookie;
    const continuationCacheKey = getContinuationCacheKey(parsedHistory, credentials, model);
    const cached = continuationCacheKey ? lookupCachedConversation(continuationCacheKey) : null;
    const conversationContext = getConversationContext(cached);
    const prompt = cached ? parsedHistory.latestUserContent : parsedHistory.foldedPrompt;
    const modelInfo = getMuseSparkModelInfo(model);
    const templateB64 = cached ? META_WS_CHAT_TEMPLATE_B64 : META_WS_HOME_TEMPLATE_B64;
    const warmupResult = await graphqlPost(
      META_AI_WARMUP_DOC_ID,
      { conversationId: conversationContext.conversationId },
      cookieHeader,
      "Warmup",
      signal,
      proxyOptions
    );
    if (isGraphqlFailure(warmupResult)) {
      evictContinuationIfNeeded(cached, continuationCacheKey);
      log?.error?.("MUSE-SPARK-WEB", `Warmup failed: ${warmupResult.error}`);
      return errorResult(warmupResult.status === 429 ? 429 : warmupResult.status === 401 || warmupResult.status === 403 ? 401 : 502, warmupResult.status === 401 || warmupResult.status === 403 ? "Meta AI session expired; re-import your ecto_1_sess cookie." : warmupResult.error, "meta_ai_warmup_failed", {}, body);
    }
    const modeResult = await graphqlPost(
      META_AI_MODE_SWITCH_DOC_ID,
      { input: { conversationId: conversationContext.conversationId, mode: modelInfo.mode } },
      cookieHeader,
      "Mode switch",
      signal,
      proxyOptions
    );
    if (isGraphqlFailure(modeResult)) {
      evictContinuationIfNeeded(cached, continuationCacheKey);
      log?.error?.("MUSE-SPARK-WEB", `Mode switch failed: ${modeResult.error}`);
      return errorResult(modeResult.status === 429 ? 429 : modeResult.status === 401 || modeResult.status === 403 ? 401 : 502, modeResult.status === 401 || modeResult.status === 403 ? "Meta AI session expired; re-import your ecto_1_sess cookie." : modeResult.error, "meta_ai_mode_switch_failed", {}, body);
    }
    const wsResult = await wsChat(
      prompt,
      conversationContext.conversationId,
      authorization,
      cookieHeader,
      templateB64,
      signal
    );
    const headers = {};
    if (wsResult.error) {
      evictContinuationIfNeeded(cached, continuationCacheKey);
      log?.error?.("MUSE-SPARK-WEB", `WS error: ${wsResult.error}`);
      const lower = wsResult.error.toLowerCase();
      const status = /429|rate.limit/.test(lower) ? 429 : /auth|authorization|401/.test(lower) ? 401 : 502;
      const message = status === 401 ? `${wsResult.error} \u2014 your meta.ai ecto_1_sess cookie may be missing or expired; re-paste the ecto_1_sess value from DevTools.` : wsResult.error;
      return errorResult(status, message, "meta_ai_ws_error", headers, body);
    }
    const content = wsResult.content || "";
    if (!content && !wsResult.deltas.length) {
      evictContinuationIfNeeded(cached, continuationCacheKey);
      log?.error?.("MUSE-SPARK-WEB", "WS returned empty response");
      return errorResult(
        502,
        "Meta AI returned no assistant content",
        "meta_ai_empty_response",
        headers,
        body
      );
    }
    const deltas = wsResult.deltas.length > 0 ? wsResult.deltas : [content];
    const parsed = {
      content,
      deltas,
      reasoningContent: "",
      reasoningDeltas: [],
      errorCode: null,
      errorMessage: null,
      status: 200
    };
    if (content) {
      rememberAssistantTurn(parsed, credentials, model, parsedHistory, conversationContext);
    }
    return buildSuccessResult(parsed, stream, model, headers, body, hasTools, requestedTools);
  }
}
export {
  META_WS_CHAT_TEMPLATE_B64,
  META_WS_HOME_TEMPLATE_B64,
  MuseSparkWebExecutor,
  __fetchFreshAccessTokenForTesting,
  __resetMuseSparkConversationCacheForTesting,
  __resetMuseSparkTokenCacheForTesting,
  __setMuseSparkBrowserPoolForTesting,
  __setMuseSparkFreshTokenFetcherForTesting,
  __setMuseSparkWebSocketForTesting,
  buildWsPromptFrame2 as buildWsPromptFrame,
  normalizeMetaAiCookieHeader,
  parseProtoFields
};
