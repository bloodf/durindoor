import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { buildErrorBody, errorResponse, sanitizeErrorMessage } from "../utils/error.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { toOpenAIFinish } from "../translator/concerns/finishReason.js";
import { applyThinking, captureThinking } from "../translator/concerns/thinkingUnified.js";

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
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
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

function messageContentFromOpenAI(content) {
  const text = textFromContent(content);
  return [{ type: "text", text }];
}

function mergeAdjacentMessages(messages) {
  const merged = [];
  for (const message of messages) {
    if (!message || !message.role) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content.push(...message.content);
    } else {
      merged.push({ role: message.role, content: [...message.content] });
    }
  }
  return merged;
}

function resolveMaxTokens(openAiBody) {
  const value = openAiBody.max_tokens ?? openAiBody.max_completion_tokens ?? openAiBody.max_output_tokens;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 4096;
}

export function buildZenmuxAnthropicBody(openAiBody = {}, modelId = "deepseek/deepseek-chat") {
  const messages = Array.isArray(openAiBody.messages) ? openAiBody.messages : [];
  const systemText = messages
    .filter((message) => message?.role === "system" || message?.role === "developer")
    .map((message) => textFromContent(message.content))
    .filter(Boolean)
    .join("\n\n");
  const conversation = messages.filter((message) => message?.role === "user" || message?.role === "assistant");
  const anthropicMessages = mergeAdjacentMessages(conversation.map((message) => ({
    role: message.role,
    content: messageContentFromOpenAI(message.content),
  })));

  const jsonInstruction = buildJsonInstruction(openAiBody.response_format);

  const body = {
    model: modelId,
    max_tokens: resolveMaxTokens(openAiBody),
    messages: anthropicMessages.length > 0
      ? anthropicMessages
      : [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    stream: true,
  };
  if (systemText || jsonInstruction) {
    body.system = [systemText, jsonInstruction].filter(Boolean).join("\n\n");
  }
  if (openAiBody.temperature !== undefined) body.temperature = openAiBody.temperature;
  if (openAiBody.stop != null) {
    body.stop_sequences = Array.isArray(openAiBody.stop) ? openAiBody.stop : [openAiBody.stop];
  }

  // Capture and apply reasoning controls using the provider-native format.
  const thinkingIntent = captureThinking(openAiBody);
  applyThinking("anthropic", modelId, body, "zenmux-free", thinkingIntent);

  return body;
}

function buildJsonInstruction(responseFormat) {
  if (!responseFormat || typeof responseFormat !== "object") return "";
  if (responseFormat.type === "json_schema" && responseFormat.json_schema?.schema) {
    const schemaJson = JSON.stringify(responseFormat.json_schema.schema, null, 2);
    return `You must respond with valid JSON that strictly follows this JSON schema:\n\`\`\`json\n${schemaJson}\n\`\`\`\nRespond ONLY with the JSON object, no other text.`;
  }
  if (responseFormat.type === "json_object") {
    return "You must respond with valid JSON. Respond ONLY with a JSON object, no other text.";
  }
  return "";
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

function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Request aborted", "AbortError");
}

async function collectText(body, signal) {
  if (!body) return { text: "", reasoning: "", stopReason: null };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  let stopReason = null;
  const onAbort = () => {
    reader.cancel(abortReason(signal)).catch(() => {});
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) throw abortReason(signal);
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortReason(signal);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const event = parseAnthropicSseData(line);
        if (!event || event === "[DONE]") continue;
        if (event.type === "error") {
          throw new Error(sanitizeErrorMessage(event.error?.message || "ZenMux streaming error"));
        }
        if (event.type === "content_block_delta" && event.delta) {
          text += event.delta.text || "";
          reasoning += event.delta.thinking || "";
        }
        if (event.type === "message_delta" && event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
      }
    }
  } finally {
    signal?.removeEventListener?.("abort", onAbort);
    reader.releaseLock();
  }

  return { text, reasoning, stopReason };
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
      let errored = false;
      const onAbort = () => {
        reader.cancel(abortReason(signal)).catch(() => {});
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      controller.enqueue(encoder.encode(openAiChunk({ id: cid, created, model, delta: { role: "assistant" } })));

      try {
        while (true) {
          if (signal?.aborted) throw abortReason(signal);
          const { done, value } = await reader.read();
          if (signal?.aborted) throw abortReason(signal);
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const event = parseAnthropicSseData(line);
            if (!event) continue;
            if (event === "[DONE]") continue;
            if (event.type === "error") {
              const errorBody = buildErrorBody(
                502,
                sanitizeErrorMessage(event.error?.message || "ZenMux streaming error"),
              );
              errored = true;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }
            if (event.type === "content_block_delta" && event.delta) {
              const text = event.delta.text || "";
              const reasoning = event.delta.thinking || "";
              const delta = {};
              if (text) delta.content = text;
              if (reasoning) delta.reasoning_content = reasoning;
              if (Object.keys(delta).length) {
                controller.enqueue(encoder.encode(openAiChunk({ id: cid, created, model, delta })));
              }
            } else if (event.type === "message_delta" && event.delta?.stop_reason) {
              controller.enqueue(encoder.encode(openAiChunk({
                id: cid,
                created,
                model,
                delta: {},
                finishReason: toOpenAIFinish(event.delta.stop_reason, "claude"),
              })));
            }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        errored = true;
        // Aborts must settle the downstream stream too; suppressing the error
        // here leaves Response consumers pending forever after reader.cancel().
        try { controller.error(error); } catch { /* consumer already closed */ }
      } finally {
        signal?.removeEventListener?.("abort", onAbort);
        reader.releaseLock();
        if (errored) return;
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

  async execute({ body, credentials, signal, stream: wantStream, proxyOptions = null }) {
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
    // Executor results are consumed by the optional on-disk request logger.
    // Keep the real cookie only in the fetch options and expose a safe summary.
    const logHeaders = { ...headers, Cookie: "[redacted]" };

    let upstream;
    try {
      upstream = await proxyAwareFetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(transformedBody),
        signal,
      }, proxyOptions);
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      return makeErrorResult(
        502,
        `ZenMux Free fetch failed: ${sanitizeErrorMessage(error.message || "unknown")}`,
        body,
        ZENMUX_FREE_CHAT_URL,
      );
    }

    if (!upstream.ok) {
      if (upstream.status === 401 || upstream.status === 403) {
        return makeErrorResult(401, "ZenMux Free: cookies expired or invalid", body, ZENMUX_FREE_CHAT_URL);
      }
      if (upstream.status === 402) {
        return makeErrorResult(402, "ZenMux Free: free-tier quota exhausted", body, ZENMUX_FREE_CHAT_URL);
      }
      const errorText = await upstream.text().catch(() => "");
      return makeErrorResult(
        upstream.status,
        `ZenMux Free error: ${sanitizeErrorMessage(errorText || upstream.statusText)}`,
        body,
        ZENMUX_FREE_CHAT_URL,
      );
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
        url: ZENMUX_FREE_CHAT_URL,
        headers: logHeaders,
        transformedBody,
      };
    }

    try {
      const { text, reasoning, stopReason } = await collectText(upstream.body, signal);
      const message = { role: "assistant", content: text };
      if (reasoning) message.reasoning_content = reasoning;
      return {
        response: new Response(JSON.stringify({
          id: cid,
          object: "chat.completion",
          created,
          model: modelId,
          choices: [{ index: 0, message, finish_reason: toOpenAIFinish(stopReason, "claude") }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: Math.ceil(text.length / 4),
            total_tokens: Math.ceil(text.length / 4),
          },
        }), { headers: { "Content-Type": "application/json" } }),
        url: ZENMUX_FREE_CHAT_URL,
        headers: logHeaders,
        transformedBody,
      };
    } catch (error) {
      if (signal?.aborted || error.name === "AbortError") {
        throw signal?.reason instanceof Error ? signal.reason : error;
      }
      return makeErrorResult(
        502,
        sanitizeErrorMessage(error.message || "ZenMux Free streaming error"),
        body,
        ZENMUX_FREE_CHAT_URL,
      );
    }
  }
}

export const __test__ = {
  collectText,
  parseAnthropicSseData,
  ZENMUX_FREE_CHAT_URL,
};

export default ZenmuxFreeExecutor;
