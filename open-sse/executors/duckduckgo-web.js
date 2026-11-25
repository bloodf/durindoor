import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { createExecutorSender, requestAbortError } from "./sendRequest.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { errorJson, extractTextFromContent, jsonResponse, readTextStream, withTimeoutSignal } from "./websession-utils.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

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
  return messages.
  map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: extractTextFromContent(message.content) })).
  filter((message) => message.content);
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
  if (!data || !isObject(data)) return "";
  return isString(data.content) ? data.content : isString(data.message) ? data.message : "";
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
    }
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

  async execute(input) {
    const { model, body, stream, signal, proxyOptions } = input;
    if (signal?.aborted) throw requestAbortError(signal.reason);
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    const messages = normalizeMessages(body?.messages || []);
    if (messages.length === 0) return { response: errorJson(400, "No messages provided", "invalid_request"), url: CHAT_URL, headers: {}, transformedBody: body };
    const setupSignal = withTimeoutSignal(signal);
    const headers = {
      Accept: "*/*",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Origin: DUCKDUCKGO_BASE,
      Referer: `${DUCKDUCKGO_BASE}/`,
      "x-vqd-accept": "1"
    };
    // Fetching the VQD token is setup; only the chat send is quota-bearing.
    const status = await sender.sendRequest(STATUS_URL, { method: "GET", headers, signal: setupSignal }, proxyOptions, { quotaBearing: false });
    const vqd4 = status.headers.get("x-vqd-4");
    const vqdHash = status.headers.get("x-vqd-hash-1");
    if (!status.ok || !vqd4 && !vqdHash) return { response: errorJson(503, "Failed to acquire DuckDuckGo VQD token"), url: STATUS_URL, headers, transformedBody: body, attemptStartedAt: sender.attemptStartedAt };

    const transformedBody = {
      model: normalizeModel(model),
      messages,
      canUseTools: true,
      metadata: { toolChoice: { NewsSearch: false, VideosSearch: false, LocalSearch: false, WeatherForecast: false } }
    };
    const chatHeaders = {
      ...headers,
      Accept: "text/event-stream",
      "x-ddg-journey-id": randomUUID().replaceAll("-", ""),
      ...(vqd4 ? { "x-vqd-4": vqd4 } : null),
      ...(vqdHash ? { "x-vqd-hash-1": vqdHash } : null)
    };
    const response = await sender.sendRequest(CHAT_URL, { method: "POST", headers: chatHeaders, body: JSON.stringify(transformedBody), signal }, proxyOptions);
    const result = (reply) => {
      transferProviderAttemptDispatch(response, reply);
      return { response: reply, url: CHAT_URL, headers: chatHeaders, transformedBody, attemptStartedAt: sender.attemptStartedAt };
    };
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return result(errorJson(response.status, text || `DuckDuckGo AI Chat returned HTTP ${response.status}`));
    }
    if (stream) return result(new Response(transformDuckStream(response.body, signal), { headers: { "Content-Type": "text/event-stream" } }));
    const content = await collectDuckText(response, signal);
    return result(jsonResponse({ id: `chatcmpl-ddg-${randomUUID().slice(0, 12)}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: transformedBody.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
  }
}