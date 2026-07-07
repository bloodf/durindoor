import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { parseSSEToOpenAIResponse } from "../handlers/chatCore/sseToJsonHandler.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const API_URL = "https://theoldllm.vercel.app/api/chatgpt";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// GPT-4o maps to "GPT_4o" (lowercase "o") — the exact id the upstream
// registry advertises (providers/registry/theoldllm.js models list).
// Previously mapped to "GPT_4O" (capital O), an id upstream never serves.
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
  gpt_4o: "GPT_4o",
  "gpt-4o": "GPT_4o",
  gpt_5_4: "GPT_5_4",
  gpt_5_3: "GPT_5_3",
  gpt_5_2: "GPT_5_2",
  gpt_5_1: "GPT_5_1",
  gpt_5: "GPT_5",
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
  "claude haiku 3.5": "CLAUDE_4_5_HAIKU",
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
  "deepseek_v4",
  "gemini_3_flash",
  "sonar-deep-research",
  "sonar-pro",
  "openrouter_web_search",
]);

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

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw new DOMException("Request aborted", "AbortError");
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

async function directFetch(reqBody, signal, proxyOptions = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const onSignal = signal ? () => controller.abort(signal.reason) : null;
  if (signal && onSignal) signal.addEventListener("abort", onSignal, { once: true });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    if (signal && onSignal) signal.removeEventListener("abort", onSignal);
  };

  try {
    const response = await proxyAwareFetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Version": "3.8.4",
        "X-Request-Token": generateRequestToken(),
        "User-Agent": CHROME_UA,
      },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    }, proxyOptions);
    clearTimeout(timer);
    return { response, release };
  } catch (error) {
    release();
    throw error;
  }
}

function bindStreamLifecycle(body, release) {
  if (!body) {
    release();
    return body;
  }

  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        release();
      }
    },
  });
}

async function readUpstreamText(response, release) {
  try {
    return await response.text();
  } finally {
    release();
  }
}

function isTokenRejected(status, body) {
  if (status === 401 || status === 403) return true;
  try {
    const parsed = JSON.parse(body);
    return (
      parsed?.error?.type === "access_denied" ||
      (typeof parsed?.error === "string" && /blocked|denied|invalid/i.test(parsed.error))
    );
  } catch {
    return false;
  }
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
    }
  }
  return JSON.stringify({
    error: { message: detail, type: "upstream_error", code: `HTTP_${status}` },
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
      "User-Agent": CHROME_UA,
    };
  }

  transformRequest(model, body) {
    if (!body || typeof body !== "object") return body;
    return { ...body, model: mapModel(model) };
  }

  async execute(input) {
    const { model, stream, body, signal, log, proxyOptions = null } = input;
    const headers = this.buildHeaders();

    throwIfAborted(signal);

    try {
      const reqBody = { ...(body || {}), model: mapModel(model), stream: true };
      let { response: upstream, release } = await directFetch(reqBody, signal, proxyOptions);
      throwIfAborted(signal);
      let upstreamText = null;

      if (upstream.status !== 200) upstreamText = await readUpstreamText(upstream, release);
      if (isTokenRejected(upstream.status, upstreamText)) {
        log?.warn?.("THEOLDLLM", `Token rejected (${upstream.status}), retrying with fresh token`);
        ({ response: upstream, release } = await directFetch(reqBody, signal, proxyOptions));
        throwIfAborted(signal);
        upstreamText = upstream.status === 200 ? null : await readUpstreamText(upstream, release);
      }

      if (upstream.status === 200) {
        if (stream) {
          return {
            response: new Response(bindStreamLifecycle(upstream.body, release), {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
              },
            }),
            url: API_URL,
            headers,
            transformedBody: body,
          };
        }

        upstreamText = upstreamText ?? await readUpstreamText(upstream, release);
        const payload = parseSSEToOpenAIResponse(upstreamText, mapModel(model));
        if (!payload) {
          return {
            response: new Response(buildErrorResponse(502, "Invalid SSE response from The Old LLM"), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            }),
            url: API_URL,
            headers,
            transformedBody: body,
          };
        }

        return {
          response: new Response(JSON.stringify(payload), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-cache",
            },
          }),
          url: API_URL,
          headers,
          transformedBody: body,
        };
      }

      return {
        response: new Response(buildErrorResponse(upstream.status, upstreamText), {
          status: upstream.status,
          headers: { "Content-Type": "application/json" },
        }),
        url: API_URL,
        headers,
        transformedBody: body,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      log?.error?.("THEOLDLLM", `Executor error: ${message}`);
      return {
        response: new Response(
          JSON.stringify({ error: { message, type: "upstream_error", code: "EXECUTOR_ERROR" } }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        ),
        url: API_URL,
        headers,
        transformedBody: body,
      };
    }
  }
}

export default TheOldLlmExecutor;
