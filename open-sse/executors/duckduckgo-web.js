import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { errorJson, extractTextFromContent, jsonResponse, readTextStream, withTimeoutSignal } from "./websession-utils.js";

const DUCKDUCKGO_BASE = "https://duckduckgo.com";
const STATUS_URL = `${DUCKDUCKGO_BASE}/duckchat/v1/status`;
const CHAT_URL = `${DUCKDUCKGO_BASE}/duckchat/v1/chat`;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function normalizeModel(model) {
  const clean = model?.startsWith?.("duckduckgo-web/") ? model.slice("duckduckgo-web/".length) : model;
  if (!clean) return "gpt-4o-mini";
  if (clean === "claude-3-5-haiku-20241022") return "claude-haiku-4-5";
  if (clean === "llama-4-scout") return "meta-llama/Llama-4-Scout-17B-16E-Instruct";
  if (clean === "mistral-small-2501") return "mistral-small-2603";
  return clean;
}

function normalizeMessages(messages = []) {
  return messages
    .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: extractTextFromContent(message.content) }))
    .filter((message) => message.content);
}

function parseDataLine(line) {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6));
  } catch {
    return null;
  }
}

function extractContent(data) {
  if (!data || typeof data !== "object") return "";
  return typeof data.content === "string" ? data.content : typeof data.message === "string" ? data.message : "";
}

function isDoneLine(line) {
  return line.trim() === "[DONE]" || line.trim() === "data: [DONE]";
}

function transformDuckStream(body, signal) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      if (signal?.aborted) {
        controller.error(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        if (isDoneLine(line)) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          continue;
        }
        const content = extractContent(parseDataLine(line));
        if (content) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, index: 0, finish_reason: null }] })}\n\n`));
      }
    },
    flush(controller) {
      if (!buffer.trim()) return;
      if (isDoneLine(buffer)) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        return;
      }
      const content = extractContent(parseDataLine(buffer));
      if (content) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, index: 0, finish_reason: null }] })}\n\n`));
    },
  }));
}

async function collectDuckText(response, signal) {
  const text = await readTextStream(response.body, signal);
  let content = "";
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || isDoneLine(line)) continue;
    content += extractContent(parseDataLine(line));
  }
  return content;
}

export class DuckDuckGoWebExecutor extends BaseExecutor {
  constructor() {
    super("duckduckgo-web", { id: "duckduckgo-web", baseUrl: DUCKDUCKGO_BASE, noAuth: true });
    this.noAuth = true;
  }

  async execute({ model, body, stream, signal, proxyOptions }) {
    const messages = normalizeMessages(body?.messages || []);
    if (messages.length === 0) return { response: errorJson(400, "No messages provided", "invalid_request"), url: CHAT_URL, headers: {}, transformedBody: body };
    const setupSignal = withTimeoutSignal(signal);
    const headers = {
      Accept: "*/*",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Origin: DUCKDUCKGO_BASE,
      Referer: `${DUCKDUCKGO_BASE}/`,
      "x-vqd-accept": "1",
    };
    const status = await proxyAwareFetch(STATUS_URL, { method: "GET", headers, signal: setupSignal }, proxyOptions);
    const vqd4 = status.headers.get("x-vqd-4");
    const vqdHash = status.headers.get("x-vqd-hash-1");
    if (!status.ok || (!vqd4 && !vqdHash)) return { response: errorJson(503, "Failed to acquire DuckDuckGo VQD token"), url: STATUS_URL, headers, transformedBody: body };

    const transformedBody = {
      model: normalizeModel(model),
      messages,
      canUseTools: true,
      metadata: { toolChoice: { NewsSearch: false, VideosSearch: false, LocalSearch: false, WeatherForecast: false } },
    };
    const chatHeaders = {
      ...headers,
      Accept: "text/event-stream",
      "x-ddg-journey-id": randomUUID().replaceAll("-", ""),
      ...(vqd4 ? { "x-vqd-4": vqd4 } : {}),
      ...(vqdHash ? { "x-vqd-hash-1": vqdHash } : {}),
    };
    const response = await proxyAwareFetch(CHAT_URL, { method: "POST", headers: chatHeaders, body: JSON.stringify(transformedBody), signal }, proxyOptions);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { response: errorJson(response.status, text || `DuckDuckGo AI Chat returned HTTP ${response.status}`), url: CHAT_URL, headers: chatHeaders, transformedBody };
    }
    if (stream) return { response: new Response(transformDuckStream(response.body, signal), { headers: { "Content-Type": "text/event-stream" } }), url: CHAT_URL, headers: chatHeaders, transformedBody };
    const content = await collectDuckText(response, signal);
    return { response: jsonResponse({ id: `chatcmpl-ddg-${randomUUID().slice(0, 12)}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: transformedBody.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }), url: CHAT_URL, headers: chatHeaders, transformedBody };
  }
}
