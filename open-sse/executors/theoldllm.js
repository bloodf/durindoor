import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const API_URL = "https://theoldllm.vercel.app/api/chatgpt";
const CHROME_UA =
"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const GPT_MODELS = {
  "gpt-5.4": "GPT_5_4",
  "gpt-5.3": "GPT_5_3",
  "gpt-5.2": "GPT_5_2",
  "gpt-5.1": "GPT_5_1",
  "gpt-5": "GPT_5",
  gpt5_4: "GPT_5_4",
  gpt5_3: "GPT_5_3",
  gpt5_2: "GPT_5_2",
  gpt5_1: "GPT_5_1",
  gpt_4o: "GPT_4O",
  "gpt-4o": "GPT_4O",
  gpt_5_4: "GPT_5_4",
  gpt_5_3: "GPT_5_3",
  gpt_5_2: "GPT_5_2",
  gpt_5_1: "GPT_5_1",
  gpt_5: "GPT_5"
};

const CLAUDE_NAMES = {
  "claude-4.6-opus": "CLAUDE_4_6_OPUS",
  "claude-4.6-sonnet": "CLAUDE_4_6_SONNET",
  "claude-4.5-haiku": "CLAUDE_4_5_HAIKU",
  claude_opus_4: "CLAUDE_4_6_OPUS",
  claude_sonnet_4: "CLAUDE_4_6_SONNET",
  claude_haiku_3_5: "CLAUDE_4_5_HAIKU",
  "claude opus 4": "CLAUDE_4_6_OPUS",
  "claude sonnet 4": "CLAUDE_4_6_SONNET",
  "claude haiku 3.5": "CLAUDE_4_5_HAIKU"
};

export const CHATGPT_UPSTREAM_MODELS = new Set([
"GPT_5_4",
"GPT_5_3",
"GPT_5_2",
"GPT_5_1",
"GPT_5",
"GPT_o4_mini",
"GPT_o3_mini",
"gemini_3_pro",
"gemini_2_5_pro",
"gemini_2_0_flash",
"gemini_1_5_flash",
"CLAUDE_4_6_OPUS",
"CLAUDE_4_6_SONNET",
"CLAUDE_4_5_HAIKU",
"openrouter_gpt_4_o",
"openrouter_gpt_4_o_mini",
"openrouter_gpt_4",
"openrouter_grok_4",
"together_deepseek_r1",
"openrouter_deepseek_r1",
"together_deepseek_v3",
"openrouter_deepseek_v3",
"sonar-deep-research",
"sonar-pro",
"openrouter_web_search"]
);

export function mapModel(model = "") {
  const trimmed = String(model).trim();
  if (CHATGPT_UPSTREAM_MODELS.has(trimmed)) return trimmed;

  const normalized = trimmed.toLowerCase();
  const gptDashKey = normalized.replace(/[_\s]+/g, "-");
  if (GPT_MODELS[gptDashKey]) return GPT_MODELS[gptDashKey];

  const gptUnderscoreKey = normalized.replace(/[-\s]+/g, "_");
  if (GPT_MODELS[gptUnderscoreKey]) return GPT_MODELS[gptUnderscoreKey];
  if (CLAUDE_NAMES[normalized]) return CLAUDE_NAMES[normalized];
  if (normalized.includes("claude")) {
    if (normalized.includes("opus")) return "CLAUDE_4_6_OPUS";
    if (normalized.includes("sonnet")) return "CLAUDE_4_6_SONNET";
    if (normalized.includes("haiku")) return "CLAUDE_4_5_HAIKU";
  }
  if (normalized.includes("gpt") && normalized.includes("5")) return "GPT_5_4";
  return "GPT_5_4";
}

export function generateRequestToken() {
  const now = Date.now();
  const seed = `${now}-oldllm-client-2026-${CHROME_UA.slice(0, 20)}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash &= hash;
  }
  return `${now.toString(36)}-${Math.abs(hash).toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export const tokenCache = { value: "", expiresAt: 0 };

async function directFetch(reqBody, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const onSignal = signal ? () => controller.abort(signal.reason) : null;
  if (signal && onSignal) signal.addEventListener("abort", onSignal, { once: true });

  try {
    return await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Version": "3.8.4",
        "X-Request-Token": generateRequestToken(),
        "User-Agent": CHROME_UA
      },
      body: JSON.stringify(reqBody),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
    if (signal && onSignal) signal.removeEventListener("abort", onSignal);
  }
}

function isTokenRejected(status, body) {
  if (status === 401 || status === 403) return true;
  try {
    const parsed = JSON.parse(body);
    return (
      parsed?.error?.type === "access_denied" ||
      isString(parsed?.error) && /blocked|denied|invalid/i.test(parsed.error));

  } catch {
    return false;
  }
}

function parseSseContent(sseText) {
  let content = "";
  for (const line of sseText.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try {
      const data = JSON.parse(line.slice(6));
      content += data.choices?.[0]?.delta?.content || data.choices?.[0]?.delta?.text || "";
    } catch {

      // Ignore malformed upstream frames and preserve successfully parsed text.
    }}
  return content;
}

function buildChatCompletion(content, model) {
  return JSON.stringify({
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: mapModel(model),
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  });
}

function buildErrorResponse(status, body) {
  let detail = body;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try {
      const parsed = JSON.parse(line.slice(6));
      if (parsed.error) {
        detail = JSON.stringify(parsed.error);
        break;
      }
    } catch {

      // Keep the raw body preview if no structured error can be parsed.
    }}
  return JSON.stringify({
    error: { message: detail, type: "upstream_error", code: `HTTP_${status}` }
  });
}

export class TheOldLlmExecutor extends BaseExecutor {
  constructor() {
    super("theoldllm", { format: "openai", noAuth: true });
  }

  buildUrl() {
    return API_URL;
  }

  buildHeaders() {
    return {
      "Content-Type": "application/json",
      "X-Client-Version": "3.8.4",
      "User-Agent": CHROME_UA
    };
  }

  transformRequest(model, body) {
    if (!body || !isObject(body)) return body;
    return { ...body, model: mapModel(model) };
  }

  async execute(input) {
    const { model, stream, body, signal, log } = input;
    const headers = this.buildHeaders();

    if (signal?.aborted) {
      return {
        response: new Response(
          JSON.stringify({ error: { message: "Request aborted", type: "abort", code: "ABORTED" } }),
          { status: 499, headers: { "Content-Type": "application/json" } }
        ),
        url: API_URL,
        headers,
        transformedBody: body
      };
    }

    try {
      const reqBody = { ...(body || {}), model: mapModel(model), stream: true };
      let upstream = await directFetch(reqBody, signal);
      let upstreamText = await upstream.text();

      if (isTokenRejected(upstream.status, upstreamText)) {
        log?.warn?.("THEOLDLLM", `Token rejected (${upstream.status}), retrying with fresh token`);
        upstream = await directFetch(reqBody, signal);
        upstreamText = await upstream.text();
      }

      if (upstream.status === 200 && upstreamText) {
        const payload = stream ? upstreamText : buildChatCompletion(parseSseContent(upstreamText), model);
        return {
          response: new Response(payload, {
            status: 200,
            headers: {
              "Content-Type": stream ? "text/event-stream" : "application/json",
              "Cache-Control": "no-cache"
            }
          }),
          url: API_URL,
          headers,
          transformedBody: body
        };
      }

      return {
        response: new Response(buildErrorResponse(upstream.status, upstreamText), {
          status: upstream.status,
          headers: { "Content-Type": "application/json" }
        }),
        url: API_URL,
        headers,
        transformedBody: body
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log?.error?.("THEOLDLLM", `Executor error: ${message}`);
      return {
        response: new Response(
          JSON.stringify({ error: { message, type: "upstream_error", code: "EXECUTOR_ERROR" } }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        ),
        url: API_URL,
        headers,
        transformedBody: body
      };
    }
  }
}

export default TheOldLlmExecutor;