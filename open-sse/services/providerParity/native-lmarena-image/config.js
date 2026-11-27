// Arena (formerly LMArena) image: provider metadata for the staged,
// unregistered, fail-fast adapter in ./adapter.js. Nothing here is imported by
// production code; the shared registry, catalog and imageProviders/index.js
// stay untouched (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (the `lmarena` entry) and
// open-sse/config/providers/registry/lmarena/directModels.ts (the 27 rows with
// category "Image", static scrape 2026-07-09, in source order). The source
// entry declares format "openai", so its handler (handlers/imageGeneration.ts)
// falls through to the generic OpenAI image forwarder. That forwarder has no
// "cookie" auth branch and no Arena envelope, so the source never sends a
// native Arena image request. This bundle records that state and does NOT
// claim a working provider.

import { isString } from "../../../../src/shared/utils/typeChecks.js";

export const LMARENA_IMAGE_PROVIDER_ID = "lmarena";
export const LMARENA_IMAGE_PROVIDER_ALIASES = Object.freeze(["lma"]);
/** Model prefixes the source strips (resolveLmarenaArenaId). */
export const LMARENA_IMAGE_MODEL_PREFIXES = Object.freeze(["lmarena", "lma", "arena"]);

/** Source registry fields, verbatim. */
export const LMARENA_IMAGE_BASE_URL = "https://arena.ai/nextjs-api/stream/create-evaluation";
export const LMARENA_IMAGE_ORIGIN = "https://arena.ai";
export const LMARENA_IMAGE_AUTH_TYPE = "apikey";
export const LMARENA_IMAGE_AUTH_HEADER = "cookie";
export const LMARENA_IMAGE_FORMAT = "openai";
export const LMARENA_IMAGE_SUPPORTED_SIZES = Object.freeze(["1024x1024", "1024x1792", "1792x1024"]);
/** Supabase SSR session cookie the chat executor sends (executors/lmarena/cookie.ts). */
export const LMARENA_AUTH_COOKIE = "arena-auth-prod-v1";

/** The answer for every recognised request. Names no credential or upstream body. */
export const LMARENA_IMAGE_UNSUPPORTED_REASON =
  "Arena (lmarena) image generation is not supported: the pinned source has no native arena.ai " +
  "image transport (its generic OpenAI image handler sends neither the Arena request envelope nor " +
  "the session cookie). Use Arena image models in the arena.ai web app.";

function row(catalogId, arenaId, publicName, displayName, organization, vision) {
  return Object.freeze({
    id: catalogId,
    arenaId,
    publicName,
    name: displayName,
    organization,
    vision,
    inputModalities: Object.freeze(vision ? ["text", "image"] : ["text"]),
  });
}

/** The source's 27 Direct-chat Image rows, in source order. `id` is the catalog id. */
export const LMARENA_IMAGE_MODELS = Object.freeze([
  row("cosmos3-super", "019f4270-5d10-723c-8a7e-dfd5dd2214e5", "cosmos3-super", "cosmos3-super", "nvidia", false),
  row("cosmos3-super-agentic", "019f4270-9eea-79c3-b18f-71303ee41ff8", "cosmos3-super-agentic", "cosmos3-super-agentic", "nvidia", false),
  row("flux-2-dev", "019b478d-74ae-7d19-9a8f-6cfde89ab4ca", "flux-2-dev", "flux-2-dev", "bfl", true),
  row("flux-2-pro", "019b7541-5e4b-7ff7-a34b-b0255b6ca9aa", "flux-2-pro", "flux-2-pro", "bfl", true),
  row("gemini-2.5-flash-image-preview (nano-banana)", "0199ef2a-583f-7088-b704-b75fd169401d", "gemini-2.5-flash-image-preview (nano-banana)", "gemini-2.5-flash-image-preview (nano-banana)", "google", true),
  row("instant-ramen", "019ed3b3-c4f8-7e67-b72d-385d740096d0", "instant-ramen", "gemini-3.1-flash-lite-image (nano-banana-2-lite)", "google", true),
  row("gpt-image-1", "6e855f13-55d7-4127-8656-9168a9f4dcc0", "gpt-image-1", "gpt-image-1", "openai", true),
  row("blue-crab", "019e4271-4717-7dd9-a0e2-90783fbabd25", "blue-crab", "grok-imagine-image-quality (20260519)", "xai", true),
  row("hidream-o1-image", "019e1cd7-5cc5-75d2-8b3e-275616dec624", "hidream-o1-image", "hidream-o1-image", "hidream", false),
  row("sungod", "019bec2d-e92c-745d-ae46-c7166590237a", "sungod", "hunyuan-image-3.0-instruct", "tencent", true),
  row("ideogram-v3-quality", "73378be5-cdba-49e7-b3d0-027949871aa6", "ideogram-v3-quality", "ideogram-v3-quality", "Ideogram", false),
  row("krea-2-large", "019e8ebd-6cfb-7492-949c-a2c4a00301aa", "krea-2-large", "krea-2-large", "krea", false),
  row("krea-2-turbo", "019f049d-7de4-7fae-8237-1c2103b9e730", "krea-2-turbo", "krea-2-turbo", "krea", false),
  row("lucid-origin", "5a3b3520-c87d-481f-953c-1364687b6e8f", "lucid-origin", "lucid-origin", "leonardo-ai", false),
  row("kakarot-v2", "019e80aa-37bf-7e89-8a28-41e4ab72ed9f", "kakarot-v2", "mai-image-2.5 (image-edit)", "microsoft-ai", true),
  row("baryonyx", "019e530d-2a50-75e3-95d1-a5ef41d4c24c", "baryonyx", "mai-image-2.5 (text-to-image)", "microsoft-ai", false),
  row("iron-bloom", "019ef780-25ef-7878-8b91-307f8f879d42", "iron-bloom", "muse-image", "meta", true),
  row("photon", "e7c9fa2d-6f5d-40eb-8305-0980b11c7cab", "photon", "photon", "luma-ai", false),
  row("qwen-image-2.0", "019d287c-4906-7f9c-8b78-8a2a86cf00a5", "qwen-image-2.0", "qwen-image-2.0", "alibaba", true),
  row("qwen-image-2.0-pro", "019d287b-b718-7daa-ad65-502596d0813d", "qwen-image-2.0-pro", "qwen-image-2.0-pro", "alibaba", true),
  row("recraft-v4", "019c6e76-a7c0-7b05-8dce-bbe3d52c8f4e", "recraft-v4", "recraft-v4", "Recraft", false),
  row("avalon", "019e7091-f73f-7338-b5e2-4ab5fba37dc2", "avalon", "reve-2.0 (image-edit)", "reve", true),
  row("babylon", "019e86c6-a3dc-73ac-9adc-8c5f304dc2fb", "babylon", "reve-2.0 (text-to-image)", "reve", false),
  row("seedream-5.0-pro", "019f42b5-8c52-7793-9be8-de35eecf7ea9", "seedream-5.0-pro", "seedream-5.0-pro", "bytedance", true),
  row("uni-1.1-max", "019ed208-69ca-7f3f-85ee-182d5f0ea08b", "uni-1.1-max", "uni-1.1-max", "luma-ai", true),
  row("wan2.7-image-pro", "019db3f0-b024-7478-bd4d-55ea1ec1d421", "wan2.7-image-pro", "wan2.7-image-pro", "wan", true),
  row("zen-bear-v3", "019f38c2-002d-7f0f-a391-db6df024b734", "zen-bear-v3", "zen-bear-v3", "alibaba", false),
]);
export const LMARENA_IMAGE_MODEL_IDS = Object.freeze(LMARENA_IMAGE_MODELS.map((model) => model.id));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX_RE = /^(?:lmarena|lma|arena)\//i;

/**
 * The image model entry for a requested id, or null. Mirrors the source
 * resolveLmarenaArenaId (prefix strip; catalog id, public name or display name,
 * exact then case-insensitive; an Arena UUID) but only over Image rows, so a
 * chat or search model, or an unknown UUID, never resolves here.
 */
export function resolveLmarenaImageModel(requested) {
  if (!isString(requested)) return null;
  const raw = requested.replace(PREFIX_RE, "").trim();
  if (!raw) return null;
  if (UUID_RE.test(raw)) {
    const lowerId = raw.toLowerCase();
    return LMARENA_IMAGE_MODELS.find((model) => model.arenaId === lowerId) ?? null;
  }
  const exact = LMARENA_IMAGE_MODELS.find((model) => model.id === raw || model.publicName === raw || model.name === raw);
  if (exact) return exact;
  const lower = raw.toLowerCase();
  return LMARENA_IMAGE_MODELS.find((model) =>
    model.id.toLowerCase() === lower || model.publicName.toLowerCase() === lower || model.name.toLowerCase() === lower) ?? null;
}

/** Metadata the registration change may consult. `supported: false` is the source state. */
export const LMARENA_IMAGE_PROVIDER_METADATA = Object.freeze({
  id: LMARENA_IMAGE_PROVIDER_ID,
  aliases: LMARENA_IMAGE_PROVIDER_ALIASES,
  format: LMARENA_IMAGE_FORMAT,
  baseUrl: LMARENA_IMAGE_BASE_URL,
  authType: LMARENA_IMAGE_AUTH_TYPE,
  authHeader: LMARENA_IMAGE_AUTH_HEADER,
  localConnectionAuthType: "cookie",
  serviceKinds: Object.freeze(["image"]),
  imageModels: LMARENA_IMAGE_MODELS,
  supportedSizes: LMARENA_IMAGE_SUPPORTED_SIZES,
  supported: false,
  unsupported: true,
  unsupportedReason: LMARENA_IMAGE_UNSUPPORTED_REASON,
  supportedResponseFormats: Object.freeze([]),
  dynamicDiscovery: "none: the source model list is a static scrape and live arena.ai HTML discovery is disabled",
});
