import { getExecutor } from "../executors/index.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function countValueChars(value) {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).length;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countValueChars(item), 0);
  }
  if (typeof value === "object") {
    return Object.entries(value).reduce((total, [key, item]) => {
      return total + key.length + countValueChars(item);
    }, 0);
  }
  return 0;
}

function countContentBlockChars(block) {
  if (block == null) return 0;
  if (typeof block === "string") return block.length;
  if (typeof block !== "object") return countValueChars(block);

  switch (block.type) {
    case "text":
      return countValueChars(block.text);
    case "tool_use":
      return countValueChars(block.name) + countValueChars(block.input);
    case "tool_result":
      return countValueChars(block.content);
    case "thinking":
      return countValueChars(block.thinking);
    default:
      return countValueChars(block);
  }
}

function countMessageChars(message) {
  if (!message || typeof message !== "object") return 0;
  const content = message.content;

  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce((total, block) => total + countContentBlockChars(block), 0);
  }
  return countValueChars(content);
}

// PROVIDERS[id] IS the transport object (built by buildTransport), so cfg.baseUrl
// and cfg.format are top-level. Claude-compatible providers serve /messages; the
// count_tokens endpoint is the sibling /messages/count_tokens. Returns null when
// the provider isn't Claude-compatible (no /messages baseUrl).
export function deriveCountTokensUrl(cfg) {
  const rec = isRecord(cfg) ? cfg : undefined;
  const base = typeof rec?.baseUrl === "string" ? rec?.baseUrl : undefined;
  const fmt = rec?.format;
  if (base && (fmt === "claude" || /\/messages$/.test(base))) {
    return /\/messages$/.test(base) ? `${base}/count_tokens` : `${base}/messages/count_tokens`;
  }
  return null;
}

// Heuristic estimate (~4 chars/token) — the fallback when no native endpoint.
// Counts structured Anthropic blocks (text, tool_use, tool_result, thinking) plus
// system + tools so count_tokens no longer underreports when Claude Code sends
// tool-heavy or thinking-heavy history (#2419).
export function estimateTokens(body) {
  const b = isRecord(body) ? body : {};
  const messages = Array.isArray(b.messages) ? b.messages : [];
  let totalChars = 0;
  if (typeof b.system === "string") totalChars += b.system.length;
  else if (Array.isArray(b.system)) {
    for (const block of b.system) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        totalChars += block.text.length;
      }
    }
  }
  if (Array.isArray(b.tools)) totalChars += JSON.stringify(b.tools).length;
  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (!isRecord(part)) continue;
        if (part.type === "text" && typeof part.text === "string") totalChars += part.text.length;
        else if (part.type === "tool_use") {
          totalChars += (part.name || "").length + JSON.stringify(part.input ?? {}).length;
        } else if (part.type === "tool_result") {
          if (typeof part.content === "string") totalChars += part.content.length;
          else if (Array.isArray(part.content)) {
            for (const c of part.content) {
              if (isRecord(c) && c.type === "text" && c.text) totalChars += c.text.length;
            }
          }
        } else if (part.type === "thinking" && typeof part.thinking === "string") {
          totalChars += part.thinking.length;
        }
      }
    }
  }
  return Math.max(1, Math.ceil(totalChars / 4));
}

/**
 * Count a request's input tokens, preferring the provider's native
 * `/messages/count_tokens` endpoint and falling back to the heuristic estimate
 * when no endpoint exists or the call fails.
 *
 * Extracted so the chatCore context preflight and the public count-tokens route
 * agree on the number instead of each rolling their own counting.
 *
 * @returns {Promise<{ tokens: number, approximate: boolean }>}
 */
export async function countInputTokens({ body, modelInfo, credentials = null, log = null, signal = null }) {
  const { provider, model } = modelInfo ?? {};
  const url = deriveCountTokensUrl(PROVIDERS[provider]);
  if (!url) return { tokens: estimateTokens(body), approximate: true };

  try {
    const headers = getExecutor(provider).buildHeaders(credentials || {}, false);
    const res = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      // An already-translated body carries the provider-facing model id
      // (upstreamModelId). Overwriting it with the catalog alias would make
      // the upstream reject the count and silently degrade to the estimate.
      body: JSON.stringify(typeof body?.model === "string" && body.model ? body : { ...body, model }),
      ...(signal ? { signal } : {}),
    });
    if (res.ok) {
      const json = await res.json();
      const tokens = Number(json?.input_tokens);
      if (Number.isFinite(tokens) && tokens >= 0) return { tokens, approximate: false };
    } else {
      log?.debug?.("COUNT-TOKENS", `native failed (${res.status}), falling back to estimate`);
    }
  } catch (err) {
    log?.debug?.("COUNT-TOKENS", `native threw: ${err?.message}, falling back to estimate`);
  }
  return { tokens: estimateTokens(body), approximate: true };
}

/**
 * Core count_tokens handler. Calls the provider's native /messages/count_tokens
 * when the upstream is Claude-compatible; otherwise falls back to the heuristic
 * estimate, flagged approximate:true.
 *
 * @param {object} options
 * @param {object} options.body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} [options.credentials]
 * @param {object} [options.log]
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleCountTokensCore({
  body,
  modelInfo,
  credentials = null,
  log = null,
}) {
  const { provider, model } = modelInfo;
  if (deriveCountTokensUrl(PROVIDERS[provider])) {
    log?.debug?.("COUNT-TOKENS", `${provider} | ${model} | native`);
  }
  const { tokens, approximate } = await countInputTokens({ body, modelInfo, credentials, log });
  return {
    success: true,
    status: 200,
    response: Response.json(approximate ? { input_tokens: tokens, approximate: true } : { input_tokens: tokens }),
  };
}
