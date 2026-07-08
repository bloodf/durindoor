import { BaseExecutor } from "./base.js";
import {
  errorJson,
  estimateTokens,
  extractCookieValue,
  extractTextFromContent,
  fetchWithTimeout,
  jsonResponse,
  mergeUpstreamExtraHeaders,
  readTextStream,
  sanitizeErrorMessage,
  stripCookieInputPrefix,
} from "./websession-utils.js";

const YUANBAO_BASE = "https://yuanbao.tencent.com";
const CREATE_URL = `${YUANBAO_BASE}/api/user/agent/conversation/create`;
const CHAT_URL = `${YUANBAO_BASE}/api/chat`;
const DEFAULT_AGENT_ID = "naQivTmsDa";
const DEFAULT_MODEL = "deepseek-v3";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

const MODEL_MAP = {
  "deepseek-v3": { chatModelId: "deep_seek_v3" },
  "deepseek-r1": { chatModelId: "deep_seek" },
  "deepseek-v3-search": { chatModelId: "deep_seek_v3", supportFunctions: ["supportInternetSearch"] },
  "deepseek-r1-search": { chatModelId: "deep_seek", supportFunctions: ["supportInternetSearch"] },
  hunyuan: { chatModelId: "hunyuan_gpt_175B_0404" },
  "hunyuan-t1": { chatModelId: "hunyuan_t1" },
  "hunyuan-search": { chatModelId: "hunyuan_gpt_175B_0404", supportFunctions: ["supportInternetSearch"] },
  "hunyuan-t1-search": { chatModelId: "hunyuan_t1", supportFunctions: ["supportInternetSearch"] },
};

function isEncryptedCredentialBlob(value) {
  return typeof value === "string" && value.trim().startsWith("enc:v1:");
}

function buildPrompt(messages) {
  const parts = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    const text = extractTextFromContent(msg.content).trim();
    if (text) parts.push({ role, content: text });
  }
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].content;
  return parts.map((part) => `#[${part.role.trim()}]\n${part.content}`).join("\n\n");
}

export function buildYuanbaoCookie(rawApiKey = "") {
  const raw = stripCookieInputPrefix(rawApiKey);
  const hyUser = extractCookieValue(raw, "hy_user");
  const hyToken = extractCookieValue(raw, "hy_token");
  if (hyUser && hyToken) return { cookie: `hy_source=web; hy_user=${hyUser}; hy_token=${hyToken}`, hasToken: true };
  return { cookie: raw, hasToken: raw.includes("hy_token=") };
}

async function readUpstreamErrorDetails(response) {
  const text = await response.text().catch(() => "");
  if (!text) return { message: null, details: null };
  try {
    const parsed = JSON.parse(text);
    return { message: parsed.message || parsed.error || null, details: parsed };
  } catch {
    return { message: sanitizeErrorMessage(text), details: { body: text } };
  }
}

function parseYuanbaoDataLine(line) {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (!payload || payload === "[DONE]" || !payload.startsWith("{")) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function transformYuanbaoStream(upstream, model, id, created, signal, log) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let roleEmitted = false;
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";
      let streamErrored = false;
      const emit = (delta, finish = null) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`));
      const ensureRole = () => {
        if (!roleEmitted) {
          roleEmitted = true;
          emit({ role: "assistant", content: "" });
        }
      };
      const handleEvent = (event) => {
        if (!event) return;
        if (event.type === "think" && event.content) {
          ensureRole();
          emit({ reasoning_content: event.content });
        } else if (event.type === "text" && typeof event.msg === "string" && event.msg) {
          ensureRole();
          emit({ content: event.msg });
        }
      };
      try {
        while (true) {
          if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const event = parseYuanbaoDataLine(line);
            handleEvent(event);
          }
        }
        if (buffer.trim()) handleEvent(parseYuanbaoDataLine(buffer.trim()));
      } catch (err) {
        streamErrored = true;
        log?.error?.("YUANBAO-WEB", `Stream error: ${err}`);
        controller.error(err);
      } finally {
        if (!streamErrored) {
          ensureRole();
          emit({}, "stop");
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
        reader.releaseLock();
      }
    },
  });
}

async function collectYuanbaoResponse(upstream, signal) {
  const text = await readTextStream(upstream, signal);
  let content = "";
  let reasoning = "";
  for (const line of text.split(/\r?\n/)) {
    const event = parseYuanbaoDataLine(line);
    if (!event) continue;
    if (event.type === "think" && event.content) reasoning += event.content;
    else if (event.type === "text" && typeof event.msg === "string") content += event.msg;
  }
  return { content, reasoning };
}

export class YuanbaoWebExecutor extends BaseExecutor {
  constructor() {
    super("yuanbao-web", { id: "yuanbao-web", baseUrl: CHAT_URL });
  }

  async execute(input) {
    const { model, body, stream, credentials = {}, signal, log, upstreamExtraHeaders, proxyOptions = null } = input;
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { response: errorJson(400, "Missing or empty messages array", "invalid_request"), url: CHAT_URL, headers: {}, transformedBody: body };
    }
    if (isEncryptedCredentialBlob(credentials.apiKey)) {
      return { response: errorJson(401, "Yuanbao credentials are encrypted but STORAGE_ENCRYPTION_KEY is not loaded.", "auth_error"), url: CREATE_URL, headers: {}, transformedBody: body };
    }

    const { cookie, hasToken } = buildYuanbaoCookie(credentials.apiKey || "");
    if (!hasToken) {
      return { response: errorJson(401, "Yuanbao requires a Cookie header containing hy_user and hy_token.", "auth_error"), url: CREATE_URL, headers: {}, transformedBody: body };
    }

    const resolvedModel = model && MODEL_MAP[model] ? model : DEFAULT_MODEL;
    const modelSpec = MODEL_MAP[resolvedModel];
    const prompt = buildPrompt(messages);
    if (!prompt.trim()) {
      return { response: errorJson(400, "Empty prompt after processing messages", "invalid_request"), url: CHAT_URL, headers: {}, transformedBody: body };
    }

    const baseHeaders = { Cookie: cookie, "User-Agent": USER_AGENT, Origin: YUANBAO_BASE, Referer: `${YUANBAO_BASE}/chat/${DEFAULT_AGENT_ID}`, "X-Agentid": DEFAULT_AGENT_ID };
    let conversationId;
    try {
            const createRes = await fetchWithTimeout(CREATE_URL, { method: "POST", headers: { ...baseHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ agentId: DEFAULT_AGENT_ID }), signal }, { proxyOptions });
      if (!createRes.ok) {
        const upstreamError = await readUpstreamErrorDetails(createRes);
        let message = createRes.status === 401 || createRes.status === 403 ? "Yuanbao auth failed; hy_user/hy_token may be expired." : createRes.status === 429 ? "Yuanbao rate limited. Wait and retry." : `Yuanbao conversation creation failed (HTTP ${createRes.status})`;
        if (upstreamError.message) message = `${message}: ${upstreamError.message}`;
        return { response: errorJson(createRes.status, message, "upstream_error", { details: upstreamError.details }), url: CREATE_URL, headers: baseHeaders, transformedBody: body };
      }
      conversationId = String((await createRes.json()).id || "");
      if (!conversationId) return { response: errorJson(502, "Yuanbao did not return a conversation id"), url: CREATE_URL, headers: baseHeaders, transformedBody: body };
    } catch (err) {
      log?.error?.("YUANBAO-WEB", `Conversation creation failed: ${err?.message || err}`);
      return { response: errorJson(502, `Yuanbao connection failed: ${err?.message || err}`), url: CREATE_URL, headers: baseHeaders, transformedBody: body };
    }

    const messageUrl = `${CHAT_URL}/${conversationId}`;
    const chatBody = {
      model: "gpt_175B_0404",
      prompt,
      plugin: "Adaptive",
      displayPrompt: prompt,
      displayPromptType: 1,
      options: { imageIntention: { needIntentionModel: true, backendUpdateFlag: 2, intentionStatus: true } },
      multimedia: [],
      agentId: DEFAULT_AGENT_ID,
      supportHint: 1,
      version: "v2",
      chatModelId: modelSpec.chatModelId,
    };
    if (modelSpec.supportFunctions) chatBody.supportFunctions = modelSpec.supportFunctions;
    const chatHeaders = { ...baseHeaders, "Content-Type": "application/json", Accept: "text/event-stream" };
    mergeUpstreamExtraHeaders(chatHeaders, upstreamExtraHeaders);

    let upstreamResponse;
    try {
            upstreamResponse = await fetchWithTimeout(messageUrl, { method: "POST", headers: chatHeaders, body: JSON.stringify(chatBody), signal }, { proxyOptions });
    } catch (err) {
      log?.error?.("YUANBAO-WEB", `Message send failed: ${err?.message || err}`);
      return { response: errorJson(502, `Yuanbao connection failed: ${err?.message || err}`), url: messageUrl, headers: chatHeaders, transformedBody: chatBody };
    }

    if (!upstreamResponse.ok) {
      const upstreamError = await readUpstreamErrorDetails(upstreamResponse);
      let message = upstreamResponse.status === 401 || upstreamResponse.status === 403 ? "Yuanbao auth failed; session cookie may be expired." : upstreamResponse.status === 429 ? "Yuanbao rate limited. Wait and retry." : `Yuanbao returned HTTP ${upstreamResponse.status}`;
      if (upstreamError.message) message = `${message}: ${upstreamError.message}`;
      return { response: errorJson(upstreamResponse.status, message, "upstream_error", { details: upstreamError.details }), url: messageUrl, headers: chatHeaders, transformedBody: chatBody };
    }
    if (!upstreamResponse.body) return { response: errorJson(502, "Yuanbao returned empty response body"), url: messageUrl, headers: chatHeaders, transformedBody: chatBody };

    const id = `chatcmpl-yuanbao-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    if (stream) {
      return { response: new Response(transformYuanbaoStream(upstreamResponse.body, resolvedModel, id, created, signal, log), { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } }), url: messageUrl, headers: chatHeaders, transformedBody: chatBody };
    }

    const { content, reasoning } = await collectYuanbaoResponse(upstreamResponse.body, signal);
    const messagePayload = { role: "assistant", content };
    if (reasoning) messagePayload.reasoning_content = reasoning;
    return {
      response: jsonResponse({
        id,
        object: "chat.completion",
        created,
        model: resolvedModel,
        choices: [{ index: 0, message: messagePayload, finish_reason: "stop" }],
        usage: { prompt_tokens: estimateTokens(prompt), completion_tokens: estimateTokens(content + reasoning), total_tokens: estimateTokens(prompt) + estimateTokens(content + reasoning) },
      }),
      url: messageUrl,
      headers: chatHeaders,
      transformedBody: chatBody,
    };
  }
}
