// SYNTX chat model catalog, staged and not registered (#1234, #2034).
// Port of OmniRoute c71f0065 open-sse/services/syntxModels.ts: the seed
// fallback list, prefix stripping, `ai_name` inference and the live
// `GET /api/v1/llm/models?enabled_only=true&lang=en` discovery parser.
// Fork deviation: the discovery cache is keyed by a SHA-256 of the account
// token (the source used the token's last 16 characters) and held per
// catalog instance, so two accounts never share a model list.
import { createHash } from "node:crypto";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { SYNTX_API_BASE, SYNTX_MODELS_TTL_MS, SYNTX_PROVIDER_ALIAS, SYNTX_PROVIDER_ID } from "./config.js";

export const SYNTX_MODELS_URL = `${SYNTX_API_BASE}/api/v1/llm/models?enabled_only=true&lang=en`;
export const SYNTX_DEFAULT_MODEL = "gpt-5-nano-2025-08-07";

/** Source SYNTX_FALLBACK_MODELS, verbatim. */
export const SYNTX_FALLBACK_MODELS = Object.freeze([
  {
    id: "claude-fable-5-1",
    name: "Claude Fable 5.1",
    aiName: "claude",
    vision: true,
    thinking: true,
    contextLength: 2_000_000,
    maxOutputTokens: 20_000,
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    aiName: "claude",
    vision: true,
    thinking: true,
    contextLength: 256_000,
    maxOutputTokens: 16_000,
  },
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    aiName: "claude",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    aiName: "claude",
    vision: true,
    thinking: true,
    contextLength: 256_000,
    maxOutputTokens: 32_000,
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    aiName: "claude",
    vision: true,
    thinking: true,
    contextLength: 256_000,
    maxOutputTokens: 32_000,
  },
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    aiName: "claude",
    vision: true,
    thinking: true,
    contextLength: 256_000,
    maxOutputTokens: 32_000,
  },
  {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    aiName: "claude",
    vision: true,
    thinking: true,
    contextLength: 256_000,
    maxOutputTokens: 32_000,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    aiName: "claude",
    vision: true,
    thinking: true,
    contextLength: 256_000,
    maxOutputTokens: 32_000,
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    aiName: "claude",
    vision: true,
    thinking: true,
    contextLength: 256_000,
    maxOutputTokens: 32_000,
  },
  {
    id: "qwen3-max-2026-01-23",
    name: "Qwen 3 Max",
    aiName: "qwen",
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 65_536,
  },
  {
    id: "qwen3.7-max",
    name: "Qwen 3.7 Max",
    aiName: "qwen",
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 65_536,
  },
  {
    id: "qwen3.7-plus",
    name: "Qwen 3.7 Plus",
    aiName: "qwen",
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 65_536,
  },
  {
    id: "deepseek-r1",
    name: "DeepSeek R1",
    aiName: "deepseek",
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 384_000,
  },
  {
    id: "deepseek-v3",
    name: "DeepSeek V3",
    aiName: "deepseek",
    contextLength: 356_000,
    maxOutputTokens: 384_000,
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    aiName: "gemini",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 65_536,
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    aiName: "gemini",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 65_536,
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    aiName: "gemini",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 65_536,
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    aiName: "gemini",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 65_536,
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    aiName: "gemini",
    vision: true,
    thinking: true,
    contextLength: 200_000,
    maxOutputTokens: 12_000,
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    aiName: "gemini",
    vision: true,
    thinking: true,
    contextLength: 200_000,
    maxOutputTokens: 12_000,
  },
  {
    id: "gpt-5-mini-2025-08-07",
    name: "GPT-5 Mini",
    aiName: "chatgpt",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "gpt-5-nano-2025-08-07",
    name: "GPT-5 Nano",
    aiName: "chatgpt",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT 5.6 Luna",
    aiName: "chatgpt",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "gpt-6-astra",
    name: "GPT 6 Astra",
    aiName: "chatgpt",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT 5.6 Terra",
    aiName: "chatgpt",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT 5.6 Sol",
    aiName: "chatgpt",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "gpt-5.2",
    name: "GPT 5.2",
    aiName: "chatgpt",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "gpt-5.4",
    name: "GPT 5.4",
    aiName: "chatgpt",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "gpt-5.5",
    name: "GPT 5.5",
    aiName: "chatgpt",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "sonar",
    name: "Perplexity Sonar + Internet",
    aiName: "perplexity",
    contextLength: 128_000,
    maxOutputTokens: 8192,
  },
  {
    id: "grok-4.6",
    name: "Grok 4.6",
    aiName: "grok",
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 32_800,
  },
  {
    id: "grok-4.3",
    name: "Grok 4.3",
    aiName: "grok",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 131_072,
  },
  {
    id: "grok-4.5",
    name: "Grok 4.5",
    aiName: "grok",
    vision: true,
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 32_768,
  },
  {
    id: "glm-5.2",
    name: "GLM 5.2",
    aiName: "zai",
    thinking: true,
    contextLength: 356_000,
    maxOutputTokens: 128_000,
  },
].map((model) => Object.freeze(model)));

const FALLBACK_BY_ID = new Map(SYNTX_FALLBACK_MODELS.map((model) => [model.id, model]));

/** Source stripSyntxModelPrefix: `syntx/` and `stx/` prefixes; empty -> default model. */
export function stripSyntxModelPrefix(model) {
  const raw = (isString(model) ? model : "").trim();
  if (raw.startsWith(`${SYNTX_PROVIDER_ID}/`)) return raw.slice(SYNTX_PROVIDER_ID.length + 1) || SYNTX_DEFAULT_MODEL;
  if (raw.startsWith(`${SYNTX_PROVIDER_ALIAS}/`)) return raw.slice(SYNTX_PROVIDER_ALIAS.length + 1) || SYNTX_DEFAULT_MODEL;
  return raw || SYNTX_DEFAULT_MODEL;
}

/** Source mapSyntxModel: `auto` / `default` -> the default model; other ids pass through. */
export function mapSyntxModel(model) {
  const stripped = stripSyntxModelPrefix(model);
  if (!stripped || stripped === "auto" || stripped === "default") return SYNTX_DEFAULT_MODEL;
  return stripped;
}

/** Source inferSyntxAiName: the `?ai_name=` query of POST /api/v1/llm/generate. */
export function inferSyntxAiName(modelId, catalog) {
  const bare = stripSyntxModelPrefix(modelId);
  const id = bare.toLowerCase();
  const hit = catalog?.get?.(bare) || FALLBACK_BY_ID.get(bare);
  if (hit?.aiName) return hit.aiName;
  if (id.startsWith("claude")) return "claude";
  if (id.startsWith("gemini")) return "gemini";
  if (id.startsWith("qwen")) return "qwen";
  if (id.startsWith("deepseek")) return "deepseek";
  if (id.startsWith("grok")) return "grok";
  if (id.startsWith("glm") || id.startsWith("zai")) return "zai";
  if (id === "sonar" || id.includes("perplexity") || id.startsWith("pplx")) return "perplexity";
  return "chatgpt";
}

const stringField = (rec, key) => (isString(rec[key]) ? rec[key].trim() : "");

function parseOneChatModel(row, seen) {
  if (!isRecord(row)) return null;
  const id = stringField(row, "id");
  if (!id || seen.has(id)) return null;
  seen.add(id);
  const caps = isRecord(row.capabilities) ? row.capabilities : {};
  return {
    id,
    name: stringField(row, "label") || id,
    aiName: stringField(row, "ai_name") || inferSyntxAiName(id),
    vision: caps.images === true,
    thinking: caps.thinking === true,
    contextLength: isNumber(row.context_window) ? row.context_window : undefined,
    maxOutputTokens: isNumber(row.default_max_tokens) ? row.default_max_tokens : undefined,
  };
}

/** Source parseSyntxModelsCatalog: `{ models: [...] }` or a bare array. */
export function parseSyntxModelsCatalog(json) {
  const rows = isRecord(json) && Array.isArray(json.models) ? json.models : Array.isArray(json) ? json : [];
  const seen = new Set();
  const models = [];
  for (const row of rows) {
    const model = parseOneChatModel(row, seen);
    if (model) models.push(model);
  }
  return models;
}

/** Registry model rows (source registry index.ts: toolCalling true, supportsVision from the seed). */
export const SYNTX_REGISTRY_MODELS = Object.freeze(SYNTX_FALLBACK_MODELS.map((model) => Object.freeze({
  id: model.id,
  name: model.name,
  toolCalling: true,
  supportsVision: model.vision === true,
})));

const accountKey = (token) => createHash("sha256").update(`syntx-models\0${token}`).digest("hex");

/**
 * Source discoverSyntxModels / getSyntxCatalogMap with a per-instance,
 * account-keyed cache. `request(url, init)` is the caller's bounded fetch;
 * it receives the account's Bearer headers and must not follow redirects.
 */
export function createSyntxModelCatalog({ ttlMs = SYNTX_MODELS_TTL_MS, now = Date.now } = {}) {
  const cache = new Map();
  async function discover({ token, request, headers }) {
    const response = await request(SYNTX_MODELS_URL, { method: "GET", headers });
    if (!response.ok) {
      const error = new Error(`SYNTX models HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const models = parseSyntxModelsCatalog(await response.json());
    if (models.length === 0) throw new Error("SYNTX models catalog was empty");
    cache.set(accountKey(token), { models, byId: new Map(models.map((model) => [model.id, model])), ts: now() });
    return models;
  }
  async function catalogMap(options) {
    const cached = cache.get(accountKey(options.token));
    if (cached && now() - cached.ts < ttlMs) return cached.byId;
    try {
      const models = await discover(options);
      return new Map(models.map((model) => [model.id, model]));
    } catch {
      return new Map(SYNTX_FALLBACK_MODELS.map((model) => [model.id, { ...model }]));
    }
  }
  return { discover, catalogMap, clear: () => cache.clear() };
}
