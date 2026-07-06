import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { errorResponse } from "../utils/error.js";

export const ZENMUX_FREE_CHAT_URL = "https://zenmux.ai/api/anthropic/v1/messages";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export function normalizeZenmuxCookie(value) {
  return String(value || "")
    .trim()
    .replace(/^Cookie:\s*/i, "")
    .replace(/\r?\n/g, "; ")
    .replace(/;\s*;/g, ";")
    .trim();
}

export function extractZenmuxCtoken(cookieHeader) {
  const match = normalizeZenmuxCookie(cookieHeader).match(/(?:^|;\s*)ctoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (part.type === "input_text" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function buildZenmuxAnthropicBody(openAiBody = {}, modelId = "deepseek/deepseek-chat") {
  const messages = Array.isArray(openAiBody.messages) ? openAiBody.messages : [];
  const systemText = messages
    .filter((message) => message?.role === "system" || message?.role === "developer")
    .map((message) => textFromContent(message.content))
    .filter(Boolean)
    .join("\n\n");
  const conversation = messages.filter((message) => message?.role === "user" || message?.role === "assistant");
  const lastUser = [...conversation].reverse().find((message) => message.role === "user");
  const userText = textFromContent(lastUser?.content) || "Hello";
  const text = systemText ? `${systemText}\n\n${userText}` : userText;
  const maxTokens = Number.isFinite(openAiBody.max_tokens) ? openAiBody.max_tokens : 4096;

  const body = {
    model: modelId,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: [{ type: "text", text }] }],
    stream: true,
  };
  if (openAiBody.temperature !== undefined) body.temperature = openAiBody.temperature;
  return body;
}

function openAiChunk({ id, created, model, delta, finishReason = null }) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function parseAnthropicSseData(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data: ")) return null;
  const raw = trimmed.slice(6);
  if (!raw || raw === "[DONE]") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function collectText(body) {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const event = parseAnthropicSseData(line);
        if (!event || event === "[DONE]") continue;
        if (event.type === "content_block_delta" && event.delta) {
          text += event.delta.text || event.delta.thinking || "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return text;
}

function buildStreamingResponse(upstream, model, cid, created, signal) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.body?.getReader();
      if (!reader) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }

      let buffer = "";
      controller.enqueue(encoder.encode(openAiChunk({ id: cid, created, model, delta: { role: "assistant" } })));

      try {
        while (true) {
          if (signal?.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const event = parseAnthropicSseData(line);
            if (!event) continue;
            if (event === "[DONE]") continue;
            if (event.type === "content_block_delta" && event.delta) {
              const text = event.delta.text || event.delta.thinking || "";
              if (text) {
                controller.enqueue(encoder.encode(openAiChunk({ id: cid, created, model, delta: { content: text } })));
              }
            } else if (event.type === "message_delta" && event.delta?.stop_reason) {
              controller.enqueue(encoder.encode(openAiChunk({
                id: cid,
                created,
                model,
                delta: {},
                finishReason: event.delta.stop_reason,
              })));
            }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        if (!signal?.aborted) controller.error(error);
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

function makeErrorResult(status, message, body, url) {
  return {
    response: errorResponse(status, message),
    url,
    headers: {},
    transformedBody: body,
  };
}

export class ZenmuxFreeExecutor extends BaseExecutor {
  constructor() {
    super("zenmux-free", PROVIDERS["zenmux-free"]);
  }

  async execute({ body, credentials, signal, stream: wantStream }) {
    const rawCookie = normalizeZenmuxCookie(credentials?.apiKey);
    const ctoken = extractZenmuxCtoken(rawCookie);
    if (!ctoken) {
      return makeErrorResult(
        401,
        "ZenMux Free: ctoken not found in cookies. Export all cookies from zenmux.ai and paste the Cookie header.",
        body,
        ZENMUX_FREE_CHAT_URL
      );
    }

    const bodyObj = body || {};
    const modelId = bodyObj.model || "deepseek/deepseek-chat";
    const transformedBody = buildZenmuxAnthropicBody(bodyObj, modelId);
    const url = new URL(ZENMUX_FREE_CHAT_URL);
    url.searchParams.set("ctoken", ctoken);
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: "text/event-stream",
      Origin: "https://zenmux.ai",
      Referer: "https://zenmux.ai/platform/chat",
      "anthropic-version": "2023-06-01",
      "chat-request-id": randomUUID().replace(/-/g, ""),
      "x-zenmux-accept-processing": "true, true",
      "x-zenmux-apikey-source": "subscription",
      Cookie: rawCookie,
    };

    let upstream;
    try {
      upstream = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(transformedBody),
        signal,
      });
    } catch (error) {
      return makeErrorResult(502, `ZenMux Free fetch failed: ${error.message || "unknown"}`, body, url.toString());
    }

    if (!upstream.ok) {
      if (upstream.status === 401 || upstream.status === 403) {
        return makeErrorResult(401, "ZenMux Free: cookies expired or invalid", body, url.toString());
      }
      if (upstream.status === 402) {
        return makeErrorResult(402, "ZenMux Free: free-tier quota exhausted", body, url.toString());
      }
      const errorText = await upstream.text().catch(() => "");
      return makeErrorResult(upstream.status, `ZenMux Free error: ${errorText || upstream.statusText}`, body, url.toString());
    }

    const cid = `chatcmpl-zmf-${randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    if (wantStream) {
      return {
        response: new Response(buildStreamingResponse(upstream, modelId, cid, created, signal), {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
        url: url.toString(),
        headers,
        transformedBody,
      };
    }

    const text = await collectText(upstream.body);
    return {
      response: new Response(JSON.stringify({
        id: cid,
        object: "chat.completion",
        created,
        model: modelId,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: Math.ceil(text.length / 4),
          total_tokens: Math.ceil(text.length / 4),
        },
      }), { headers: { "Content-Type": "application/json" } }),
      url: url.toString(),
      headers,
      transformedBody,
    };
  }
}

export const __test__ = {
  collectText,
  parseAnthropicSseData,
  ZENMUX_FREE_CHAT_URL,
};

export default ZenmuxFreeExecutor;
