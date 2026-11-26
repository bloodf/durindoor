import { FORMATS } from "../translator/formats.js";

/**
 * Providers whose upstream bills an unchanged message prefix as a cache read,
 * either automatically (openai, codex, azure) or at `cache_control` breakpoints.
 * Every Claude-format target caches as well. OmniRoute #20433.
 */
export const PROMPT_CACHE_PROVIDERS = Object.freeze(new Set([
  "claude", "anthropic", "openai", "codex", "azure", "deepseek", "zai", "glm", "glm-cn",
  "kimi-coding", "kimi-coding-apikey", "xiaomi-mimo", "alibaba", "alibaba-cn",
  "alicode", "alicode-intl", "qwen-cloud", "bedrock"
]));

/**
 * True when compression must leave the provider-cached prefix alone. A request
 * estimated above a known context window is not protected: a cache hit is no use
 * when the upstream rejects the request for its size.
 */
export function shouldProtectCachedPrefix({ provider, format, estimatedTokens = 0, contextWindow = null }) {
  if (contextWindow > 0 && estimatedTokens > contextWindow) return false;
  return format === FORMATS.CLAUDE || PROMPT_CACHE_PROVIDERS.has(provider);
}
