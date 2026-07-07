import { createHash, randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { prepareToolMessages, buildToolAwareResult } from "../translator/webTools.js";

const INNER_AI_CHAT_URL = "https://chatapi.innerai.com/chat";
const INNER_AI_PROFILE_URL = "https://platformapi.innerai.com/api/v1/users/profile";
const INNER_AI_MODELS_URL = "https://platformapi.innerai.com/api/v1/ai_models";
const USER_AGENT = "Mozilla/5.0 AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36";
const MODELS_CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

const credentialCache = new Map();
const modelsCache = new Map();

function sanitizeErrorMessage(message) {
  return String(message || "Upstream error").replace(/token=[^;\s]+/gi, "token=[redacted]");
}

function tokenCacheKey(token) {
  return createHash("sha256").update(token).digest("hex");
}

function lruTouch(map, key) {
  const value = map.get(key);
  if (value === undefined) return undefined;
  map.delete(key);
  map.set(key, value);
  return value;
}

function lruSet(map, key, value) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > CACHE_MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function decodeJwtPayload(token) {
  try {
    const b64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!b64) return null;
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function extractTrailingEmail(value) {
  const trimmed = value.trim();
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace < 0) return "";
  const possible = trimmed.slice(lastSpace + 1).trim();
  return possible.includes("@") ? possible : "";
}

export function parseCredential(rawApiKey) {
  const trimmed = String(rawApiKey || "").trim();
  const cookieMatch = trimmed.match(/(?:^|;\s*)token=([^;\s]+)/);
  if (cookieMatch && cookieMatch[1].trim()) {
    const token = cookieMatch[1].trim();
    return { token, credEmail: extractTrailingEmail(trimmed) };
  }
  const stripped = trimmed.startsWith("eyJ") ? trimmed : trimmed.slice(trimmed.indexOf("=") + 1).trim();
  const email = extractTrailingEmail(trimmed);
  return { token: email ? stripped.slice(0, stripped.lastIndexOf(email)).trim() : stripped, credEmail: email };
}

function makeErrorResult(status, message, body) {
  return {
    response: new Response(
      JSON.stringify({
        error: {
          message: sanitizeErrorMessage(message),
          type: "upstream_error",
          code: `HTTP_${status}`,
        },
      }),
      { status, headers: { "Content-Type": "application/json" } }
    ),
    url: INNER_AI_CHAT_URL,
    headers: {},
    transformedBody: body,
  };
}

function buildHeaders(token, email, deviceId) {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Cookie: `token=${token}`,
    "USER-TOKEN": token,
    "DEVICE-ID": deviceId,
    Origin: "https://app.innerai.com",
    Referer: "https://app.innerai.com/",
  };
  if (email) headers["USER-EMAIL"] = email;
  return headers;
}

async function resolveCredentials(token, credEmail, signal) {
  const key = tokenCacheKey(token);
  const cached = lruTouch(credentialCache, key);
  if (cached) return cached;
  const payload = decodeJwtPayload(token);
  const deviceId = String(
    payload?.device_id ?? payload?.deviceId ?? payload?.["device-id"] ?? payload?.did ?? ""
  ).trim();
  let email = "";
  try {
    const profileResp = await fetch(INNER_AI_PROFILE_URL, {
      headers: {
        Cookie: `token=${token}`,
        "USER-TOKEN": token,
        "User-Agent": USER_AGENT,
        ...(deviceId ? { "DEVICE-ID": deviceId } : {}),
        Origin: "https://app.innerai.com",
        Referer: "https://app.innerai.com/",
      },
      signal: signal ?? undefined,
    });
    if (profileResp.ok) {
      const body = await profileResp.json().catch(() => null);
      email = String(
        body?.data?.email ?? body?.user?.email ?? body?.profile?.email ?? body?.email ?? ""
      ).trim();
    }
  } catch {
    // Profile fetch is a best-effort email discovery step.
  }
  if (!email && credEmail) email = credEmail;
  if (!email && typeof payload?.sub === "string" && payload.sub.includes("@")) email = payload.sub;
  const creds = { email, deviceId };
  lruSet(credentialCache, key, creds);
  return creds;
}

class InnerAiModelsError extends Error {
  constructor(status, responsePreview) {
    super(`Inner.ai /ai-models returned HTTP ${status}`);
    this.name = "InnerAiModelsError";
    this.status = status;
    this.responsePreview = responsePreview;
  }
}

async function resolveModels(token, deviceId, email, signal) {
  const key = tokenCacheKey(token);
  const cached = lruTouch(modelsCache, key);
  if (cached && Date.now() < cached.expiresAt) return cached.models;
  const resp = await fetch(INNER_AI_MODELS_URL, {
    headers: buildHeaders(token, email, deviceId),
    signal: signal ?? undefined,
  });
  if (!resp.ok) {
    const preview = await resp.text().catch(() => "");
    if (resp.status === 401 || resp.status === 403) credentialCache.delete(key);
    throw new InnerAiModelsError(resp.status, preview.slice(0, 200));
  }
  const body = await resp.json().catch(() => null);
  const raw = Array.isArray(body)
    ? body
    : Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.ai_models)
        ? body.ai_models
        : [];
  const planRaw = String(
    decodeJwtPayload(token)?.plan ?? decodeJwtPayload(token)?.tier ?? decodeJwtPayload(token)?.subscription ?? ""
  ).toLowerCase();
  const isUltra = planRaw.includes("ultra") || planRaw.includes("enterprise");
  const isPro = isUltra || planRaw.includes("pro") || planRaw.includes("plus");
  const nonTextPattern = /image|video|audio|img|vid|sound|music|voice|tts|stt|flux|stable.diff|sora-|whisper/i;
  const models = raw.filter((model) => {
    if (model.enable === false || model.unavailable_api) return false;
    if (model.ultra_only && !isUltra) return false;
    if (model.pro_only && !isPro) return false;
    const cats = Array.isArray(model.ai_model_categories) ? model.ai_model_categories : null;
    if (cats?.length) {
      return cats.some((cat) => String(cat.unique_identifier ?? cat.name ?? "").toLowerCase() === "text");
    }
    return !nonTextPattern.test(String(model.llm_model || ""));
  });
  lruSet(modelsCache, key, { models, expiresAt: Date.now() + MODELS_CACHE_TTL_MS });
  return models;
}

export function findModel(models, requestedId) {
  if (!models.length) return null;
  const lower = requestedId.toLowerCase();
  return (
    models.find((m) => m.llm_model === requestedId) ||
    models.find((m) => String(m.llm_model).toLowerCase() === lower) ||
    models.find((m) => String(m.llm_model).toLowerCase().includes(lower)) ||
    null
  );
}

function buildMessageContent(messages) {
  const parts = [];
  for (const msg of messages) {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((c) => c?.type === "text").map((c) => String(c.text ?? "")).join("")
          : "";
    if (!content.trim()) continue;
    if (msg.role === "system") parts.push(`[Instructions]\n${content}`);
    else if (msg.role === "assistant") parts.push(`[Assistant]\n${content}`);
    else parts.push(content);
  }
  return parts.join("\n\n");
}

function transformInnerAiSSE(upstream, model) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let buffer = "";
  let emittedRole = false;
  const chunkEvent = (delta, finishReason = null) =>
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            let data;
            try {
              data = JSON.parse(raw);
            } catch {
              continue;
            }
            if (data.type === "text" && data.item) {
              if (!emittedRole) {
                emittedRole = true;
                controller.enqueue(encoder.encode(chunkEvent({ role: "assistant", content: "" })));
              }
              controller.enqueue(encoder.encode(chunkEvent({ content: String(data.item) })));
            } else if (data.type === "end_stream") {
              if (!emittedRole) {
                emittedRole = true;
                controller.enqueue(encoder.encode(chunkEvent({ role: "assistant", content: "" })));
              }
              controller.enqueue(encoder.encode(chunkEvent({}, "stop")));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            } else if (["missing_credits", "reached_limit", "rate_limit_reached", "rate_limit_longer_reached"].includes(data.type)) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ error: { message: "Inner.ai: rate limit reached", type: "rate_limit_error", code: data.type } })}\n\n`)
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: { message: sanitizeErrorMessage(err.message), type: "upstream_error" } })}\n\n`)
        );
      }
      if (!emittedRole) controller.enqueue(encoder.encode(chunkEvent({ role: "assistant", content: "" })));
      controller.enqueue(encoder.encode(chunkEvent({}, "stop")));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

class InnerAiStreamError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "InnerAiStreamError";
    this.status = status;
    this.code = code;
  }
}

async function collectContent(upstream) {
  const decoder = new TextDecoder();
  const reader = upstream.getReader();
  let buffer = "";
  let content = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      if (data.type === "text" && typeof data.item === "string") content += data.item;
      if (["missing_credits", "reached_limit", "rate_limit_reached", "rate_limit_longer_reached"].includes(data.type)) {
        throw new InnerAiStreamError(429, data.type, "Inner.ai: rate limit reached");
      }
    }
  }
  return content;
}

export class InnerAiExecutor extends BaseExecutor {
  constructor() {
    super("inner-ai", { id: "inner-ai", baseUrl: INNER_AI_CHAT_URL, format: "openai" });
  }

  async execute(input) {
    const { body, credentials, signal, stream: wantStream } = input;
    const bodyObj = body || {};
    const rawToken = String(credentials?.apiKey ?? "").trim();
    if (!rawToken) {
      return makeErrorResult(401, "Missing Inner.ai token cookie", body);
    }
    const { token, credEmail } = parseCredential(rawToken);
    let creds;
    try {
      creds = await resolveCredentials(token, credEmail, signal);
    } catch (err) {
      credentialCache.delete(tokenCacheKey(token));
      return makeErrorResult(401, err instanceof Error ? err.message : "Failed to authenticate with Inner.ai", body);
    }

    const requestedModel = String(bodyObj.model ?? "").trim() || "gpt-4o";
    let models = [];
    try {
      models = await resolveModels(token, creds.deviceId, creds.email, signal);
    } catch (err) {
      if (err instanceof InnerAiModelsError && (err.status === 401 || err.status === 403)) {
        return makeErrorResult(err.status, "Inner.ai /ai-models authentication failed; re-paste your token cookie", body);
      }
    }
    const modelEntry = findModel(models, requestedModel) || { id: "", llm_model: requestedModel };
    const rawMessages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(bodyObj, rawMessages);
    const messageContent = buildMessageContent(effectiveMessages);
    if (!messageContent.trim()) return makeErrorResult(400, "No message content to send", body);

    const innerAiBody = {
      message: messageContent,
      session_id: randomUUID(),
      context_type: "no_context",
      ai_model: { id: modelEntry.id || undefined, llm_model: modelEntry.llm_model || requestedModel },
      is_extension: false,
      env: "production",
      temporary: true,
      use_web_search: false,
      knowledge_list: [],
    };
    const reqHeaders = buildHeaders(token, creds.email, creds.deviceId);

    let upstream;
    try {
      upstream = await fetch(INNER_AI_CHAT_URL, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(innerAiBody),
        signal: signal ?? undefined,
      });
    } catch (err) {
      return makeErrorResult(502, `Inner.ai request failed: ${sanitizeErrorMessage(err.message)}`, body);
    }

    if (upstream.status === 401 || upstream.status === 403) {
      credentialCache.delete(tokenCacheKey(token));
      return makeErrorResult(upstream.status, "Inner.ai authentication failed; re-paste your token cookie", body);
    }
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      return makeErrorResult(upstream.status, `Inner.ai returned HTTP ${upstream.status}: ${errText}`, body);
    }
    if (!upstream.body) return makeErrorResult(502, "Inner.ai returned an empty response", body);

    const resolvedModel = modelEntry.llm_model || requestedModel;
    if (wantStream === false) {
      // non-stream requested — parse tool blocks if present.
      let content;
      try {
        content = await collectContent(upstream.body);
      } catch (err) {
        if (err instanceof InnerAiStreamError) return makeErrorResult(err.status, err.message, body);
        throw err;
      }
      const completionId = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (hasTools) {
        const parsed = buildToolAwareResult(content, requestedTools, "inner");
        if (parsed.toolCalls) {
          return {
            response: new Response(
              JSON.stringify({
                id: completionId,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: resolvedModel,
                choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: parsed.toolCalls }, finish_reason: parsed.finishReason }],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            ),
            url: INNER_AI_CHAT_URL,
            headers: reqHeaders,
            transformedBody: innerAiBody,
          };
        }
        content = parsed.content;
      }
      return {
        response: new Response(
          JSON.stringify({
            id: completionId,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: resolvedModel,
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
          { headers: { "Content-Type": "application/json" } }
        ),
        url: INNER_AI_CHAT_URL,
        headers: reqHeaders,
        transformedBody: innerAiBody,
      };
    }
    if (hasTools) {
      // tool requests must be parsed; synthesize an OpenAI-compatible SSE stream.
      let content;
      try {
        content = await collectContent(upstream.body);
      } catch (err) {
        if (err instanceof InnerAiStreamError) return makeErrorResult(err.status, err.message, body);
        throw err;
      }
      const completionId = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const parsed = buildToolAwareResult(content, requestedTools, "inner");
      if (parsed.toolCalls) {
        const toolCalls = parsed.toolCalls;
        const streamBody = [
          `data: ${JSON.stringify({ id: completionId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: resolvedModel, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
          ...toolCalls.map((call, index) => `data: ${JSON.stringify({ id: completionId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: resolvedModel, choices: [{ index: 0, delta: { tool_calls: [{ index, id: call.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } }] }, finish_reason: null }] })}\n\n`),
          `data: ${JSON.stringify({ id: completionId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: resolvedModel, choices: [{ index: 0, delta: {}, finish_reason: parsed.finishReason }] })}\n\n`,
          "data: [DONE]\n\n",
        ].join("");
        return {
          response: new Response(streamBody, {
            headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
          }),
          url: INNER_AI_CHAT_URL,
          headers: reqHeaders,
          transformedBody: innerAiBody,
        };
      }
      const streamBody = [
        `data: ${JSON.stringify({ id: completionId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: resolvedModel, choices: [{ index: 0, delta: { role: "assistant", content: parsed.content }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ id: completionId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: resolvedModel, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      return {
        response: new Response(streamBody, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
        }),
        url: INNER_AI_CHAT_URL,
        headers: reqHeaders,
        transformedBody: innerAiBody,
      };
    }
    return {
      response: new Response(transformInnerAiSSE(upstream.body, resolvedModel), {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
      }),
      url: INNER_AI_CHAT_URL,
      headers: reqHeaders,
      transformedBody: innerAiBody,
    };
  }
}

export default InnerAiExecutor;
