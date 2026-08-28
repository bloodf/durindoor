/**
 * Reviewed allowlist for `scripts/model-catalog-diff.mjs` local-audit findings.
 *
 * Keys are STABLE identifiers built at finding-creation time (never parsed from
 * message text). Values are the short human reason recorded at review:
 *   - `provider:modelId`          → upstreamModelId is a proxy/wire id, not an
 *                                   in-provider registry id.
 *   - `pricing:<key>`             → MODEL_PRICING row keyed by a wire/dated/
 *                                   dotted/effort alias, not a registry id.
 *   - `pricing-pattern:<pattern>` → PATTERN_PRICING forward glob matching no
 *                                   current registry id by design.
 */
export const REVIEWED_ORPHANS = new Map([
  ["blackbox:claude-fable-5", "proxy upstreamModelId"],
  ["blackbox:claude-opus-4.8", "proxy upstreamModelId"],
  ["blackbox:claude-sonnet-4.6", "proxy upstreamModelId"],
  ["blackbox:gpt-5.5", "proxy upstreamModelId"],
  ["blackbox:gpt-5.4-pro", "proxy upstreamModelId"],
  ["blackbox:gpt-5.4", "proxy upstreamModelId"],
  ["blackbox:gpt-5.3-codex", "proxy upstreamModelId"],
  ["blackbox:gpt-5.4-nano", "proxy upstreamModelId"],
  ["blackbox:deepseek-v4-flash", "proxy upstreamModelId"],
  ["blackbox:grok-4.3", "proxy upstreamModelId"],

  ["clinepass:glm-5.2", "proxy upstreamModelId"],
  ["clinepass:kimi-k2.7-code", "proxy upstreamModelId"],
  ["clinepass:kimi-k2.6", "proxy upstreamModelId"],
  ["clinepass:deepseek-v4-pro", "proxy upstreamModelId"],
  ["clinepass:deepseek-v4-flash", "proxy upstreamModelId"],
  ["clinepass:mimo-v2.5", "proxy upstreamModelId"],
  ["clinepass:mimo-v2.5-pro", "proxy upstreamModelId"],
  ["clinepass:minimax-m3", "proxy upstreamModelId"],
  ["clinepass:qwen3.7-max", "proxy upstreamModelId"],
  ["clinepass:qwen3.7-plus", "proxy upstreamModelId"],

  ["pricing:claude-opus-4-5-20251101", "priced alias present in upstream"],
  ["pricing:claude-sonnet-4-5-20250929", "priced alias present in upstream"],
  ["pricing:claude-opus-4.1", "priced alias present in upstream"],
  ["pricing:claude-opus-4-5-thinking", "priced alias present in upstream"],
  ["pricing:gpt-5.1-codex-mini-high", "priced alias present in upstream"],
  ["pricing:gpt-5.6", "priced alias present in upstream"],
  ["pricing:gemini-3.1-pro-high", "priced alias present in upstream"],
  ["pricing:deepseek-v3.2-chat", "priced alias present in upstream"],
  ["pricing:deepseek-v3.2-reasoner", "priced alias present in upstream"],
  ["pricing:minimax-m2.1", "priced alias present in upstream"],
  ["pricing:kimi-k3", "priced third-party registry alias"],
  ["pricing:kimi-k2.5-thinking", "priced third-party registry alias"],

  /** #599 ports #3423 forward pricing before matching registry models ship. */
  ["pricing:qwen3.8-max", "#599/#3423 intentional forward-priced id"],
  ["pricing:qwen3.8-27b", "#599/#3423 intentional forward-priced id"],
  ["pricing:qwen3.8-2.4t-a95b", "#599/#3423 intentional forward-priced id"],
  ["pricing-pattern:*muse-glimmer*", "#599/#3423 intentional forward glob"],

  ["pricing-pattern:*-codex-mini-*", "intentional forward glob"],
  ["pricing-pattern:codex-*", "intentional forward glob"],
]);
