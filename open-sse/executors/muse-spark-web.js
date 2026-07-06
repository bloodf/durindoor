import { createHash } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { parseMetaAiResponseText } from "./muse-spark-web/response-parser.js";
import {
  errorJson,
  estimateTokens,
  extractTextFromContent,
  jsonResponse,
  mergeUpstreamExtraHeaders,
  normalizeSessionCookieHeaders,
  readTextStream,
  withTimeoutSignal,
} from "./websession-utils.js";

const META_AI_GRAPHQL_API = "https://www.meta.ai/api/graphql";
const META_AI_DEFAULT_COOKIE = "ecto_1_sess";
const META_AI_SEND_MESSAGE_DOC_ID = "29ae946c82d1f301196c6ca2226400b5";
const META_AI_ROOT_BRANCH_PATH = "0";
const META_AI_ENTRY_POINT = "KADABRA__CHAT__UNIFIED_INPUT_BAR";
const META_AI_FRIENDLY_NAME = "useEctoSendMessageSubscription";
const META_AI_REQUEST_ANALYTICS_TAGS = "graphservice";
const META_AI_ASBD_ID = "129477";
const META_AI_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const MODEL_MAP = {
  "muse-spark": { mode: "mode_fast", isThinking: false },
  "muse-spark-thinking": { mode: "mode_thinking", isThinking: true },
  "muse-spark-contemplating": { mode: "think_hard", isThinking: true },
};

const conversationCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function parseOpenAIMessages(messages) {
  const normalized = [];
  for (const message of messages) {
    const role = message.role === "developer" ? "system" : String(message.role || "user");
    const content = extractTextFromContent(message.content);
    if (content) normalized.push({ role, content });
  }
  const lastUserIndex = normalized.map((m) => m.role).lastIndexOf("user");
  const lastAssistantIndex = normalized.map((m) => m.role).lastIndexOf("assistant");
  const foldedPrompt = normalized.map((m, index) => index === lastUserIndex ? m.content : `${m.role}: ${m.content}`).join("\n\n").trim();
  return { foldedPrompt, latestUserContent: lastUserIndex >= 0 ? normalized[lastUserIndex].content : "", lastAssistantIndex, normalized };
}

function cacheKey(connectionId, model, messages) {
  return createHash("sha256")
    .update(`${connectionId}\x1f${model}\x1f${messages.map((m) => `${m.role}\x1e${m.content}`).join("\x1f")}`)
    .digest("hex");
}

function lookupConversation(key) {
  const entry = conversationCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    conversationCache.delete(key);
    return null;
  }
  return entry;
}

function rememberConversation(key, context) {
  conversationCache.set(key, { ...context, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function __resetMuseSparkConversationCacheForTesting() {
  conversationCache.clear();
}

function randomNumericId() {
  return String(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}

function modelInfo(model) {
  return MODEL_MAP[model] || MODEL_MAP["muse-spark"];
}

function buildMetaAiRequestBody(prompt, model, conversation) {
  return {
    doc_id: META_AI_SEND_MESSAGE_DOC_ID,
    variables: {
      assistantMessageId: crypto.randomUUID(),
      attachments: null,
      clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      content: prompt,
      conversationId: conversation.conversationId,
      currentBranchPath: conversation.branchPath,
      devicePixelRatio: 1,
      entryPoint: META_AI_ENTRY_POINT,
      isNewConversation: conversation.isNewConversation,
      mode: modelInfo(model).mode,
      promptSessionId: crypto.randomUUID(),
      turnId: crypto.randomUUID(),
      userAgent: META_AI_USER_AGENT,
      userEventId: crypto.randomUUID(),
      userLocale: (Intl.DateTimeFormat().resolvedOptions().locale || "en-US").replace(/-/g, "_"),
      userMessageId: crypto.randomUUID(),
      userUniqueMessageId: randomNumericId(),
    },
  };
}

function buildHeaders(cookieHeader) {
  return {
    Accept: "text/event-stream",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    Origin: "https://www.meta.ai",
    Referer: "https://www.meta.ai/",
    "User-Agent": META_AI_USER_AGENT,
    "X-ASBD-ID": META_AI_ASBD_ID,
    "X-FB-Friendly-Name": META_AI_FRIENDLY_NAME,
    "X-FB-Request-Analytics-Tags": META_AI_REQUEST_ANALYTICS_TAGS,
  };
}

function buildStreamingResponse(parsed, model, id, created) {
  const encoder = new TextEncoder();
  const chunks = [
    { role: "assistant" },
    ...parsed.reasoningDeltas.map((reasoning) => ({ reasoning_content: reasoning })),
    ...(parsed.deltas.length ? parsed.deltas : [parsed.content]).map((content) => ({ content })),
  ];
  return new ReadableStream({
    start(controller) {
      for (const delta of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

export class MuseSparkWebExecutor extends BaseExecutor {
  constructor() {
    super("muse-spark-web", { id: "muse-spark-web", baseUrl: META_AI_GRAPHQL_API });
  }

  async execute({ model, body, stream, credentials = {}, signal, log, upstreamExtraHeaders }) {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) return { response: errorJson(400, "Missing or empty messages array", "invalid_request"), url: META_AI_GRAPHQL_API, headers: {}, transformedBody: body };
    const parsedHistory = parseOpenAIMessages(messages);
    if (!parsedHistory.foldedPrompt) return { response: errorJson(400, "Empty query after processing messages", "invalid_request"), url: META_AI_GRAPHQL_API, headers: {}, transformedBody: body };

    const resolvedModel = model || "muse-spark";
    const continuationKey = credentials.connectionId && parsedHistory.lastAssistantIndex >= 0 && parsedHistory.latestUserContent
      ? cacheKey(credentials.connectionId, resolvedModel, parsedHistory.normalized.slice(0, parsedHistory.lastAssistantIndex + 1))
      : null;
    const cached = continuationKey ? lookupConversation(continuationKey) : null;
    const context = cached || { conversationId: `c.${crypto.randomUUID().replaceAll("-", "").slice(0, 19)}`, branchPath: META_AI_ROOT_BRANCH_PATH, isNewConversation: true };
    const prompt = cached ? parsedHistory.latestUserContent : parsedHistory.foldedPrompt;
    const cookieHeader = normalizeSessionCookieHeaders([credentials.apiKey || "", ...(credentials.providerSpecificData?.extraApiKeys || [])], META_AI_DEFAULT_COOKIE)[0] || "";
    if (!cookieHeader) return { response: errorJson(401, "Muse Spark requires a meta.ai session cookie.", "auth_error"), url: META_AI_GRAPHQL_API, headers: {}, transformedBody: body };

    const transformedBody = buildMetaAiRequestBody(prompt, resolvedModel, context);
    const headers = buildHeaders(cookieHeader);
    mergeUpstreamExtraHeaders(headers, upstreamExtraHeaders);
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(META_AI_GRAPHQL_API, { method: "POST", headers, body: JSON.stringify(transformedBody), signal: withTimeoutSignal(signal) });
    } catch (err) {
      log?.error?.("MUSE-SPARK-WEB", `Fetch failed: ${err?.message || err}`);
      return { response: errorJson(502, `Meta AI connection failed: ${err?.message || err}`), url: META_AI_GRAPHQL_API, headers, transformedBody };
    }
    if (!upstreamResponse.ok) {
      if (cached && continuationKey) conversationCache.delete(continuationKey);
      return { response: errorJson(upstreamResponse.status, upstreamResponse.status === 401 || upstreamResponse.status === 403 ? "Meta AI auth failed; the cookie may be expired." : `Meta AI returned HTTP ${upstreamResponse.status}`), url: META_AI_GRAPHQL_API, headers, transformedBody };
    }
    const responseText = await readTextStream(upstreamResponse.body, signal);
    const parsed = parseMetaAiResponseText(responseText, modelInfo(resolvedModel).isThinking);
    if (parsed.status !== 200 || parsed.errorMessage) {
      if (cached && continuationKey) conversationCache.delete(continuationKey);
      return { response: errorJson(parsed.status, parsed.errorMessage || "Meta AI returned an unknown error", parsed.errorCode || "upstream_error"), url: META_AI_GRAPHQL_API, headers, transformedBody };
    }
    if (parsed.content && credentials.connectionId) {
      rememberConversation(cacheKey(credentials.connectionId, resolvedModel, [...parsedHistory.normalized, { role: "assistant", content: parsed.content }]), { conversationId: context.conversationId, branchPath: context.branchPath, isNewConversation: false });
    }

    const id = `chatcmpl-meta-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    if (stream) return { response: new Response(buildStreamingResponse(parsed, resolvedModel, id, created), { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } }), url: META_AI_GRAPHQL_API, headers, transformedBody };
    const message = { role: "assistant", content: parsed.content };
    if (parsed.reasoningContent) message.reasoning_content = parsed.reasoningContent;
    return { response: jsonResponse({ id, object: "chat.completion", created, model: resolvedModel, choices: [{ index: 0, message, finish_reason: "stop" }], usage: { prompt_tokens: estimateTokens(prompt), completion_tokens: estimateTokens(parsed.content + parsed.reasoningContent), total_tokens: estimateTokens(prompt) + estimateTokens(parsed.content + parsed.reasoningContent) } }), url: META_AI_GRAPHQL_API, headers, transformedBody };
  }
}
