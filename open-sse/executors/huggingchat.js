import { BaseExecutor } from "./base.js";
import { HuggingChatStreamError, readJsonlResponse, streamJsonlToOpenAi } from "./huggingchat/jsonlStream.js";
import {
  errorJson,
  estimateTokens,
  extractTextFromContent,
  fetchWithTimeout,
  jsonResponse,
  mergeUpstreamExtraHeaders,
  normalizeSessionCookieHeader,
  sanitizeErrorMessage } from
"./websession-utils.js";
import huggingchatRegistry from "../providers/registry/huggingchat.js";
import { isFunction, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const HUGGINGFACE_BASE = "https://huggingface.co";
const CONVERSATION_URL = `${HUGGINGFACE_BASE}/chat/conversation`;
const API_CONVERSATIONS_URL = `${HUGGINGFACE_BASE}/chat/api/v2/conversations`;
const DEFAULT_COOKIE_NAME = "hf-chat";
const DEFAULT_MODEL = huggingchatRegistry.models?.[0]?.id || "baidu/ERNIE-4.5-VL-424B-A47B-Base-PT";
const USER_AGENT =
"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function isEncryptedCredentialBlob(value) {
  return isString(value) && value.trim().startsWith("enc:v1:");
}

function buildConversationPrompt(messages) {
  const systemParts = [];
  const conversationParts = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    const text = extractTextFromContent(msg.content);
    if (!text) continue;
    if (role === "system" || role === "developer") systemParts.push(text);else
    if (role === "user" || role === "assistant") conversationParts.push({ role, content: text });
  }
  if (conversationParts.length === 0) return { inputs: systemParts.join("\n\n"), systemPrompt: null };
  if (conversationParts.length === 1 && conversationParts[0].role === "user") {
    return { inputs: conversationParts[0].content, systemPrompt: systemParts.join("\n\n") || null };
  }
  return {
    inputs: [...conversationParts.map((part) => `${part.role === "user" ? "User" : "Assistant"}: ${part.content}`), "Assistant:"].join("\n\n"),
    systemPrompt: systemParts.join("\n\n") || null
  };
}

function splitCombinedSetCookieHeader(header) {
  return header.split(/,(?=\s*[^;,=\s]+=)/).map((value) => value.trim()).filter(Boolean);
}

function getSetCookieHeaders(headers) {
  if (isFunction(headers.getSetCookie)) return headers.getSetCookie().filter(Boolean);
  const combined = headers.get("set-cookie");
  return combined ? splitCombinedSetCookieHeader(combined) : [];
}

function parseSetCookiePair(setCookie) {
  const pair = setCookie.split(";", 1)[0]?.trim() || "";
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1) };
}

function mergeCookieHeaderWithSetCookie(cookieHeader, setCookieHeaders) {
  const cookieMap = new Map();
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0) cookieMap.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1));
  }
  for (const setCookie of setCookieHeaders) {
    const parsed = parseSetCookiePair(setCookie);
    if (parsed?.value) cookieMap.set(parsed.name, parsed.value);
  }
  return [...cookieMap.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function unwrapSuperjsonPayload(value) {
  return value && isObject(value) && !Array.isArray(value) && value.json && isObject(value.json) ?
  value.json :
  value;
}

function extractInitialParentMessageId(value) {
  const payload = unwrapSuperjsonPayload(value);
  if (!payload || !isObject(payload) || Array.isArray(payload)) return null;
  if (isString(payload.rootMessageId) && payload.rootMessageId.trim()) return payload.rootMessageId;
  const lastMessage = Array.isArray(payload.messages) ? payload.messages.at(-1) : null;
  return isString(lastMessage?.id) && lastMessage.id.trim() ? lastMessage.id : null;
}

const REIMPORT_GUIDANCE = "Sign in at huggingface.co/chat again and re-import the hf-chat cookie for this connection.";
const PUBLIC_STREAM_ERROR = "HuggingChat generation failed";

// 401/403 are a credential failure (expired or revoked session) and 429 is quota; every step of the
// bootstrap maps them the same way so a lapsed session is never reported as a generic 502.
function upstreamFailureMessage(status, fallback) {
  if (status === 401 || status === 403) return `HuggingChat session rejected (HTTP ${status}); the hf-chat cookie is expired or revoked. ${REIMPORT_GUIDANCE}`;
  if (status === 429) return "HuggingChat quota or rate limit reached. Wait and retry, or use another connection.";
  if (status === 404) return `${fallback}. Check the model id.`;
  return fallback;
}

async function readUpstreamErrorDetails(response) {
  const text = await response.text().catch(() => "");
  if (!text) return { message: null, details: null };
  try {
    const parsed = JSON.parse(text);
    const message = parsed.message || parsed.error?.message || parsed.error || null;
    return { message: message ? sanitizeErrorMessage(String(message)) : null, details: parsed };
  } catch {
    return { message: sanitizeErrorMessage(text), details: { body: text } };
  }
}

async function fetchInitialParentMessageId(conversationId, headers, signal, proxyOptions = null) {
  const res = await fetchWithTimeout(`${API_CONVERSATIONS_URL}/${conversationId}`, { method: "GET", headers, signal }, { proxyOptions });
  if (!res.ok) return { id: null, status: res.status };
  const text = await res.text().catch(() => "");
  if (!text) return { id: null, status: 200 };
  try {
    return { id: extractInitialParentMessageId(JSON.parse(text)), status: 200 };
  } catch {
    return { id: null, status: 200 };
  }
}

export class HuggingChatExecutor extends BaseExecutor {
  constructor() {
    super("huggingchat", { id: "huggingchat", baseUrl: HUGGINGFACE_BASE });
  }

  async execute(input) {
    const { model, body, stream, credentials = {}, signal, log, upstreamExtraHeaders, proxyOptions = null } = input;
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { response: errorJson(400, "Missing or empty messages array", "invalid_request"), url: CONVERSATION_URL, headers: {}, transformedBody: body };
    }
    if (isEncryptedCredentialBlob(credentials.apiKey)) {
      return { response: errorJson(401, "HuggingChat credentials are encrypted but STORAGE_ENCRYPTION_KEY is not loaded.", "auth_error"), url: CONVERSATION_URL, headers: {}, transformedBody: body };
    }

    let cookieHeader = normalizeSessionCookieHeader(credentials.apiKey || "", DEFAULT_COOKIE_NAME);
    if (!cookieHeader) {
      return { response: errorJson(401, "HuggingChat requires an hf-chat session cookie.", "auth_error"), url: CONVERSATION_URL, headers: {}, transformedBody: body };
    }

    const resolvedModel = model || DEFAULT_MODEL;
    const { inputs, systemPrompt } = buildConversationPrompt(messages);
    if (!inputs.trim()) {
      return { response: errorJson(400, "Empty prompt after processing messages", "invalid_request"), url: CONVERSATION_URL, headers: {}, transformedBody: body };
    }

    const baseHeaders = {
      Cookie: cookieHeader,
      "User-Agent": USER_AGENT,
      Origin: HUGGINGFACE_BASE,
      Referer: `${HUGGINGFACE_BASE}/chat/`
    };
    let conversationId;
    try {
      const createBody = { model: resolvedModel };
      if (systemPrompt) createBody.preprompt = systemPrompt;
      const createRes = await fetchWithTimeout(CONVERSATION_URL, {
        method: "POST",
        headers: { ...baseHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(createBody),
        signal
      }, { proxyOptions });
      if (!createRes.ok) {
        const upstreamError = await readUpstreamErrorDetails(createRes);
        let message = upstreamFailureMessage(createRes.status, `HuggingChat conversation creation failed (HTTP ${createRes.status})`);
        if (upstreamError.message) message = `${message}: ${upstreamError.message}`;
        return { response: errorJson(createRes.status, message, "upstream_error", { details: upstreamError.details }), url: CONVERSATION_URL, headers: baseHeaders, transformedBody: body };
      }
      const createData = await createRes.json();
      conversationId = createData.conversationId;
      cookieHeader = mergeCookieHeaderWithSetCookie(cookieHeader, getSetCookieHeaders(createRes.headers));
      baseHeaders.Cookie = cookieHeader;
      if (!conversationId) {
        return { response: errorJson(502, "HuggingChat did not return a conversationId"), url: CONVERSATION_URL, headers: baseHeaders, transformedBody: body };
      }
    } catch (err) {
      log?.error?.("HUGGINGCHAT", `Conversation creation failed: ${err?.message || err}`);
      return { response: errorJson(502, `HuggingChat connection failed: ${err?.message || err}`), url: CONVERSATION_URL, headers: baseHeaders, transformedBody: body };
    }

    let parent;
    try {
      parent = await fetchInitialParentMessageId(conversationId, baseHeaders, signal, proxyOptions);
    } catch (err) {
      log?.error?.("HUGGINGCHAT", `Conversation lookup failed: ${err?.message || err}`);
      return { response: errorJson(502, `HuggingChat connection failed: ${err?.message || err}`), url: `${API_CONVERSATIONS_URL}/${conversationId}`, headers: baseHeaders, transformedBody: body };
    }
    const parentMessageId = parent.id;
    if (!parentMessageId) {
      const lookupStatus = [401, 403, 429].includes(parent.status) ? parent.status : 502;
      const lookupMessage = lookupStatus === 502 ? "HuggingChat did not return an initial parent message id" : upstreamFailureMessage(lookupStatus, "");
      return { response: errorJson(lookupStatus, lookupMessage), url: `${API_CONVERSATIONS_URL}/${conversationId}`, headers: baseHeaders, transformedBody: body };
    }

    const messageUrl = `${CONVERSATION_URL}/${conversationId}`;
    const sendDataPayload = {
      inputs,
      is_retry: false,
      is_continue: false,
      generationId: crypto.randomUUID(),
      selectedMcpServerNames: [],
      selectedMcpServers: [],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      id: parentMessageId
    };
    const formData = new FormData();
    formData.append("data", JSON.stringify(sendDataPayload));
    mergeUpstreamExtraHeaders(baseHeaders, upstreamExtraHeaders);

    let upstreamResponse;
    try {
      upstreamResponse = await fetchWithTimeout(messageUrl, { method: "POST", headers: baseHeaders, body: formData, signal }, { proxyOptions });
    } catch (err) {
      log?.error?.("HUGGINGCHAT", `Message send failed: ${err?.message || err}`);
      return { response: errorJson(502, `HuggingChat connection failed: ${err?.message || err}`), url: messageUrl, headers: baseHeaders, transformedBody: sendDataPayload };
    }

    if (!upstreamResponse.ok) {
      const upstreamError = await readUpstreamErrorDetails(upstreamResponse);
      let message = upstreamFailureMessage(upstreamResponse.status, `HuggingChat returned HTTP ${upstreamResponse.status}`);
      if (upstreamError.message) message = `${message}: ${upstreamError.message}`;
      return { response: errorJson(upstreamResponse.status, message, "upstream_error", { details: upstreamError.details }), url: messageUrl, headers: baseHeaders, transformedBody: sendDataPayload };
    }
    if (!upstreamResponse.body) {
      return { response: errorJson(502, "HuggingChat returned empty response body"), url: messageUrl, headers: baseHeaders, transformedBody: sendDataPayload };
    }

    const id = `chatcmpl-huggingchat-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const streamFailure = (err) => ({
      response: errorJson(502, err.message, "upstream_error", { code: "huggingchat_generation_error" }),
      url: messageUrl,
      headers: baseHeaders,
      transformedBody: sendDataPayload
    });

    if (stream) {
      const encoder = new TextEncoder();
      const cancellation = new AbortController();
      const jsonlStream = streamJsonlToOpenAi(upstreamResponse.body, resolvedModel, id, created, signal, cancellation.signal);
      // Prime the role and first content chunk so a generation error before any content is a real 502
      // instead of an HTTP 200 stream that fails after the client already saw success.
      const primed = [];
      try {
        const first = await jsonlStream.next();
        if (!first.done) {
          primed.push(first.value);
          if (first.value.includes('"role":"assistant"')) {
            const content = await jsonlStream.next();
            if (!content.done) primed.push(content.value);
          }
        }
      } catch (err) {
        if (!(err instanceof HuggingChatStreamError)) throw err;
        log?.error?.("HUGGINGCHAT", `Stream failed before content: ${sanitizeErrorMessage(err.message)}`);
        return streamFailure(err);
      }
      let cancelled = false;
      const sseStream = new ReadableStream({
        async pull(controller) {
          if (cancelled) return;
          if (primed.length > 0) {
            controller.enqueue(encoder.encode(primed.shift()));
            return;
          }
          try {
            const chunk = await jsonlStream.next();
            if (cancelled) return;
            if (chunk.done) controller.close();else
            controller.enqueue(encoder.encode(chunk.value));
          } catch (err) {
            if (cancelled) return;
            log?.error?.("HUGGINGCHAT", `Stream error: ${sanitizeErrorMessage(err?.message || err)}`);
            controller.error(Object.assign(new Error(PUBLIC_STREAM_ERROR), { statusCode: 502 }));
          }
        },
        cancel() {
          cancelled = true;
          cancellation.abort();
          void jsonlStream.return(undefined).catch(() => undefined);
        }
      });
      return { response: new Response(sseStream, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } }), url: messageUrl, headers: baseHeaders, transformedBody: sendDataPayload };
    }

    let text;
    let reasoning;
    try {
      ({ text, reasoning } = await readJsonlResponse(upstreamResponse.body, signal));
    } catch (err) {
      if (!(err instanceof HuggingChatStreamError)) throw err;
      log?.error?.("HUGGINGCHAT", `Generation error: ${sanitizeErrorMessage(err.message)}`);
      return streamFailure(err);
    }
    const message = { role: "assistant", content: text };
    if (reasoning) message.reasoning_content = reasoning;
    return {
      response: jsonResponse({
        id,
        object: "chat.completion",
        created,
        model: resolvedModel,
        choices: [{ index: 0, message, finish_reason: "stop" }],
        usage: { prompt_tokens: estimateTokens(inputs), completion_tokens: estimateTokens(text + reasoning), total_tokens: estimateTokens(inputs) + estimateTokens(text + reasoning) }
      }),
      url: messageUrl,
      headers: baseHeaders,
      transformedBody: sendDataPayload
    };
  }
}