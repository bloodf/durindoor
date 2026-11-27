// Arena (formerly LMArena) chat: the source-supported Direct-chat catalog and
// provider metadata. Staged; nothing in production imports this bundle (see
// ./registration.json and internal/docs/port-reports/native-lmarena-chat-catalog.md).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/providers/registry/lmarena/directModels.ts
// (LMARENA_DIRECT_CHAT_ENTRIES: the 42 category "Text" and 6 category "Search"
// rows of the 75-row static scrape dated 2026-07-09, in source order),
// open-sse/config/providers/registry/lmarena/index.ts (registry entry) and
// open-sse/executors/lmarena/models.ts (getLMArenaModels, the chat-only view).
// The 27 category "Image" rows are NOT chat models: the source routes them to
// its image registry, and that flow has no native Arena transport (see
// ../native-lmarena-image and internal/docs/port-reports/native-lmarena-image.md).

import { isString } from "../../../../src/shared/utils/typeChecks.js";

export const LMARENA_CHAT_PROVIDER_ID = "lmarena";
export const LMARENA_CHAT_PROVIDER_ALIASES = Object.freeze(["lma"]);
/** Model prefixes the source strips before resolution (resolveLmarenaArenaId, stripLMArenaModelPrefix). */
export const LMARENA_CHAT_MODEL_PREFIXES = Object.freeze(["lmarena", "lma", "arena"]);

/** Source registry fields, verbatim. */
export const LMARENA_CHAT_BASE_URL = "https://arena.ai/nextjs-api/stream/create-evaluation";
export const LMARENA_CHAT_FORMAT = "openai";
export const LMARENA_CHAT_EXECUTOR = "lmarena";
export const LMARENA_CHAT_SOURCE_AUTH_TYPE = "apikey";
export const LMARENA_CHAT_SOURCE_AUTH_HEADER = "cookie";
/** The source transformRequest sends these two fields unchanged for every chat row, Search included. */
export const LMARENA_CHAT_WIRE_MODE = "direct-battle";
export const LMARENA_CHAT_WIRE_MODALITY = "chat";
export const LMARENA_CHAT_SCRAPE_DATE = "2026-07-09";
export const LMARENA_SOURCE_TOTAL_ROWS = 75;
export const LMARENA_SOURCE_IMAGE_ROWS = 27;
export const LMARENA_CHAT_CATEGORIES = Object.freeze(["Text", "Search"]);

function row(catalogId, arenaId, publicName, displayName, organization, vision, category) {
  return Object.freeze({
    id: catalogId,
    arenaId,
    publicName,
    name: displayName,
    organization,
    vision,
    category,
    // getLMArenaModels: input text (+ image when vision), output text (+ web for Search).
    inputModalities: Object.freeze(vision ? ["text", "image"] : ["text"]),
    outputCapabilities: Object.freeze(category === "Search" ? ["text", "web"] : ["text"]),
  });
}

/** The 48 source chat rows (Text then Search), in source order. `id` is the catalog id. */
export const LMARENA_CHAT_MODELS = Object.freeze([
  row("amazon.nova-pro-v1:0", "a14546b5-d78d-4cf6-bb61-ab5b8510a9d6", "amazon.nova-pro-v1:0", "amazon.nova-pro-v1:0", "amazon", true, "Text"),
  row("claude-haiku-4-5-20251001", "0199e8e9-01ed-73e0-96ba-cf43b286bf10", "claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001", "anthropic", false, "Text"),
  row("claude-sonnet-5", "019f19f2-41f1-7c6d-9891-48d02fd9952c", "claude-sonnet-5", "claude-sonnet-5-high", "anthropic", true, "Text"),
  row("deepseek-v4-pro-thinking", "019dc1c1-c62d-7b70-85a1-e0565e29fce1", "deepseek-v4-pro-thinking", "deepseek-v4-pro-thinking", "deepseek", false, "Text"),
  row("dola-seed-2.0-preview-vision", "019c6453-641a-74f8-a689-a8a67175a359", "dola-seed-2.0-preview-vision", "dola-seed-2.0-preview-vision", "bytedance", true, "Text"),
  row("ernie-5.0-preview-1220", "019d44f1-26da-729f-a4ea-ddddfe7b4eae", "ernie-5.0-preview-1220", "ernie-5.0-preview-1220", "baidu", true, "Text"),
  row("gemini-3.1-flash-lite", "019f408a-186c-7f3a-9595-4e079e42a613", "gemini-3.1-flash-lite", "gemini-3.1-flash-lite", "google", true, "Text"),
  row("gemini-3.1-pro-preview", "019c7820-5480-78b6-9fef-04c0d7004054", "gemini-3.1-pro-preview", "gemini-3.1-pro-preview", "google", true, "Text"),
  row("gemini-3.6-flash", "019f90b1-c0ac-71ce-b295-487f261bf0f4", "gemini-3.6-flash", "gemini-3.6-flash", "google", true, "Text"),
  row("significant-otter", "019d2cd3-2641-7628-94bd-67ecb0a7134e", "significant-otter", "gemma-4-26b-a4b", "google", true, "Text"),
  row("pteronura", "019d2cd2-dd83-75ab-a421-d0ba2e22b1e3", "pteronura", "gemma-4-31b", "google", true, "Text"),
  row("glm-5.1", "019ebf6a-94d4-7649-b704-1dbbd5eb0942", "glm-5.1", "glm-5.2 (max)", "zai", false, "Text"),
  row("glm-5v-turbo", "019d4a09-9651-78cb-86ea-bb0fa5ec77f4", "glm-5v-turbo", "glm-5v-turbo", "zai", true, "Text"),
  row("gpt-oss-120b", "6ee9f901-17b5-4fbe-9cc2-13c16497c23b", "gpt-oss-120b", "gpt-oss-120b", "openai", false, "Text"),
  row("gpt-5.2-high", "019b1449-0313-7911-b836-419e2ed79b2e", "gpt-5.2-high", "gpt-5.2-high", "openai", true, "Text"),
  row("gpt-5.4-mini-high", "019cfcdd-5426-777e-8314-04619cb92cc4", "gpt-5.4-mini-high", "gpt-5.4-mini-high", "openai", true, "Text"),
  row("gpt-5.4-nano-high", "019cfcdd-0bca-706f-92b5-a4c4cbd022d8", "gpt-5.4-nano-high", "gpt-5.4-nano-high", "openai", true, "Text"),
  row("gpt-5.5-instant", "019e71ea-1e1d-740f-9c2d-dab5869ff108", "gpt-5.5-instant", "gpt-5.5-instant", "openai", true, "Text"),
  row("grok-4.3/text", "019f42aa-9c3b-76d1-8bdf-2e883b1ca227", "grok-4.3", "grok-4.5", "xai", true, "Text"),
  row("hunyuan-vision-1.5-thinking", "6a3a1e04-050e-4cb4-9052-b9ac4bec0c38", "hunyuan-vision-1.5-thinking", "hunyuan-vision-1.5-thinking", "tencent", true, "Text"),
  row("hy3", "019f3911-ba1c-7e36-b631-01893e557290", "hy3", "hy3", "tencent", false, "Text"),
  row("kimi-k2.6", "019dac54-e8a4-7c54-904a-ff0ecd82af42", "kimi-k2.6", "kimi-k2.6", "moonshot", true, "Text"),
  row("ling-2.5-1t", "019c6e76-fbbc-7e92-b0ba-784c7ef3ad8b", "ling-2.5-1t", "ling-2.5-1t", "ant-group", false, "Text"),
  row("longcat-2.0", "019f3a0a-bd19-7b19-9eed-a98453759b48", "longcat-2.0", "longcat-2.0", "meituan", false, "Text"),
  row("mercury-2", "019cc65f-c1e3-7574-b332-898ab71c8211", "mercury-2", "mercury-2", "inception-ai", false, "Text"),
  row("mimo-v2.5", "019db651-bd2f-7d80-ab12-d69c6bb623df", "mimo-v2.5", "mimo-v2.5", "xiaomi", true, "Text"),
  row("mimo-v2.5-pro", "019db650-909d-7dec-8711-1907d7233cd4", "mimo-v2.5-pro", "mimo-v2.5-pro", "xiaomi", false, "Text"),
  row("minimax-m3", "019e809d-f62d-7192-bb7f-1657e066b5f2", "minimax-m3", "minimax-m3", "minimax", true, "Text"),
  row("mistral-large-3", "019acbac-df7c-73dc-9716-ebe040daaa4e", "mistral-large-3", "mistral-large-3", "mistral", true, "Text"),
  row("mistral-medium-3.5", "019f30a4-044d-7a14-9d3b-2e7299159e36", "mistral-medium-3.5", "mistral-medium-3.5", "mistral", true, "Text"),
  row("mistral-small-2603", "019cf983-532b-73fa-a057-7658e1e1c5ee", "mistral-small-2603", "mistral-small-2603", "mistral", false, "Text"),
  row("nova-2-lite", "019ae300-83b7-7717-a1e0-31accd1ff6fa", "nova-2-lite", "nova-2-lite", "amazon", false, "Text"),
  row("nvidia-nemotron-3-nano-30b-a3b-bf16", "019b0aa7-334a-78e8-b2a8-885f31f4fc0c", "nvidia-nemotron-3-nano-30b-a3b-bf16", "nvidia-nemotron-3-nano-30b-a3b-bf16", "nvidia", false, "Text"),
  row("march26-chatbot1-public", "019cd9e3-c3ff-7225-92f2-c392259b1fbe", "march26-chatbot1-public", "nvidia-nemotron-3-super-120b-a12b", "nvidia", false, "Text"),
  row("may26-chatbot4-public", "019e8ea8-2052-7f2e-b1b6-59bd94be5203", "may26-chatbot4-public", "nvidia-nemotron-3-ultra-550b-a55b-nvfp4", "nvidia", false, "Text"),
  row("o3-2025-04-16", "cb0f1e24-e8e9-4745-aabc-b926ffde7475", "o3-2025-04-16", "o3-2025-04-16", "openai", true, "Text"),
  row("qwen3.5-397b-a17b", "019c6918-1d2a-7e3f-88ec-ada000b6ab16", "qwen3.5-397b-a17b", "qwen3.5-397b-a17b", "alibaba", true, "Text"),
  row("qwen3.7-max", "019e6530-f140-77b1-b6b8-5c859829d992", "qwen3.7-max", "qwen3.7-max", "alibaba", false, "Text"),
  row("qwen3.7-plus", "019e86fe-167d-77bd-94a8-df7aee4f4551", "qwen3.7-plus", "qwen3.7-plus", "alibaba", true, "Text"),
  row("ring-2.5-1t", "019c6e77-1b9f-7649-9136-43d07566c6c5", "ring-2.5-1t", "ring-2.5-1t", "ant-group", false, "Text"),
  row("step-3.5-flash", "019d22bb-fcf5-7866-9c07-de74fe05c9cc", "step-3.5-flash", "step-3.5-flash", "stepfun", false, "Text"),
  row("trinity-large-thinking", "019d50aa-447d-74d6-8661-405b4b6de5de", "trinity-large-thinking", "trinity-large-thinking", "arcee-ai", false, "Text"),
  row("claude-sonnet-5-search", "019f1a07-de72-7fbe-8d82-56dbd7348360", "claude-sonnet-5-search", "claude-sonnet-5-search", "anthropic", false, "Search"),
  row("gemini-2.5-pro-grounding", "b222be23-bd55-4b20-930b-a30cc84d3afd", "gemini-2.5-pro-grounding", "gemini-2.5-pro-grounding", "google", false, "Search"),
  row("gemini-3-flash-grounding", "019bda1f-3abc-783f-aac0-1ee102b247ba", "gemini-3-flash-grounding", "gemini-3-flash-grounding", "google", false, "Search"),
  row("gpt-5.2-search", "019b1448-f74a-72de-b25d-8666618f8c5a", "gpt-5.2-search", "gpt-5.2-search", "openai", false, "Search"),
  row("grok-4.3/search", "019de22d-1445-7296-9c88-a5877bc66ef8", "grok-4.3", "grok-4.3", "xai", false, "Search"),
  row("o3-search", "fbe08e9a-3805-4f9f-a085-7bc38e4b51d1", "o3-search", "o3-search", "openai", false, "Search"),
]);
export const LMARENA_CHAT_MODEL_IDS = Object.freeze(LMARENA_CHAT_MODELS.map((model) => model.id));

/**
 * The source registry `models` (LMARENA_DIRECT_MODELS): { id, name, supportsVision? }.
 * The source declares no context length for any Arena row.
 */
function sourceRegistryModel(model) {
  const out = { id: model.id, name: model.name };
  if (model.vision) out.supportsVision = true;
  return Object.freeze(out);
}
export const LMARENA_CHAT_SOURCE_REGISTRY_MODELS = Object.freeze(LMARENA_CHAT_MODELS.map(sourceRegistryModel));

/**
 * Registry rows for the integration change. Source rows in source order; for an
 * id the local registry already lists, the local `name` and `contextLength`
 * are kept so existing catalog entries do not change. Local ids the source does
 * not list are dropped (there are none today). Pure: the input is not mutated.
 * @param {Array<{id: string, name?: string, contextLength?: number}>} [localModels]
 */
export function buildLmarenaChatRegistryModels(localModels = []) {
  const local = new Map((Array.isArray(localModels) ? localModels : [])
    .filter((model) => model && isString(model.id))
    .map((model) => [model.id, model]));
  return LMARENA_CHAT_SOURCE_REGISTRY_MODELS.map((model) => {
    const existing = local.get(model.id);
    const out = { ...model };
    if (existing && isString(existing.name) && existing.name) out.name = existing.name;
    if (existing && Number.isFinite(existing.contextLength)) out.contextLength = existing.contextLength;
    return out;
  });
}

/** Metadata the registration change may consult. */
export const LMARENA_CHAT_PROVIDER_METADATA = Object.freeze({
  id: LMARENA_CHAT_PROVIDER_ID,
  aliases: LMARENA_CHAT_PROVIDER_ALIASES,
  format: LMARENA_CHAT_FORMAT,
  executor: LMARENA_CHAT_EXECUTOR,
  baseUrl: LMARENA_CHAT_BASE_URL,
  sourceAuthType: LMARENA_CHAT_SOURCE_AUTH_TYPE,
  sourceAuthHeader: LMARENA_CHAT_SOURCE_AUTH_HEADER,
  localConnectionAuthType: "cookie",
  serviceKinds: Object.freeze(["llm"]),
  categories: LMARENA_CHAT_CATEGORIES,
  wire: Object.freeze({ mode: LMARENA_CHAT_WIRE_MODE, modality: LMARENA_CHAT_WIRE_MODALITY, modelField: "modelAId" }),
  chatModels: LMARENA_CHAT_MODELS,
  dynamicDiscovery: "none: the source model list is a static scrape and live arena.ai HTML discovery is disabled",
  imageModels: "excluded: see native-lmarena-image (no native Arena image transport)",
});
