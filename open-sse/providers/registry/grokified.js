/**
 * Grokified (https://grokified.com) — prepaid Grok API gateway.
 *
 * Vendor contract (first-party docs, inspected 2026-11-20):
 *  - Docs:      https://grokified.com/docs
 *  - Errors:    https://grokified.com/docs/errors
 *  - Models:    https://grokified.com/docs/models
 *  - Base URL:  https://api.grokified.com/v1 (host and path, not the marketing site)
 *  - Auth:      `Authorization: Bearer <gk_live_… | gk_test_…>` access key, no account header
 *  - Chat:      POST /v1/chat/completions, OpenAI Chat Completions shape, SSE on the same host
 *  - Discovery: GET /v1/models, same Bearer key
 *  - Usage:     standard OpenAI `usage` block, plus a vendor `usage.grokified` cost block
 *  - Errors:    JSON `{"error":{"message","type","code"}}` with 400 invalid_request_error,
 *               401 invalid_api_key, 402 insufficient_quota / payment_required,
 *               403 account_suspended / plan_capability_required, 404 not_found,
 *               413 request_too_large, 429 rate_limit_exceeded, 5xx api_error / service_overloaded
 *
 * Distinct from:
 *  - `xai`      → api.x.ai (xAI API key and Grok Build OAuth); Grokified is a separate
 *                  vendor with its own prepaid balance and its own `gk_` key namespace.
 *  - `groq`     → api.groq.com; Groq is a different company serving different models.
 *
 * Scope: text inference over Chat Completions only. The vendor's image, video, voice
 * and remote-MCP routes, its separately billed Claude add-on, and the Responses-only
 * `grok-4.20-multi-agent-0309` model are out of scope for this port. Live service
 * behavior is not verified here; the port is covered by mocked wiring tests.
 *
 * Ported from cheaper-inference/OmniRoute
 * `open-sse/config/providers/registry/grokified/index.ts`
 * at 4624250231f49ed118fb4522a9d735e4894322c6 (id, alias, format, executor, base URL,
 * bearer auth and the seeded chat models match that entry; the seed is widened here to
 * the vendor's documented active text catalog and extended with local discovery).
 */
export default {
  id: "grokified",
  priority: 90,
  alias: "grokified",
  display: {
    name: "Grokified",
    icon: "auto_awesome",
    color: "#111827",
    textIcon: "GK",
    website: "https://grokified.com",
    notice: {
      apiKeyUrl: "https://grokified.com/keys",
      text: "Prepaid Grok API gateway. Uses your own Grokified access key and balance; it is not the official xAI console and not Groq.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.grokified.com/v1/chat/completions",
    validateUrl: "https://api.grokified.com/v1/models",
  },
  models: [
    // Vendor "Active models" table, text rows only
    // (https://grokified.com/docs/models). Context windows are the vendor's own
    // published figures; output limits are not published and stay unset.
    { id: "grok-4.7", name: "Grok 4.7", contextLength: 500000, aliases: ["grokified-4.6", "gx-1-max"] },
    { id: "grok-4.6", name: "Grok 4.6", contextLength: 500000 },
    { id: "grok-4.5", name: "Grok 4.5", contextLength: 500000, aliases: ["grokified-4.5", "gx-1-pro"] },
    { id: "grok-4.3", name: "Grok 4.3", contextLength: 1000000, aliases: ["gx-1", "grok-3", "grok-4-0709", "grok-4-fast-reasoning", "grok-4-fast-non-reasoning"] },
    { id: "grok-4.20-0309-reasoning", name: "Grok 4.20 Reasoning", contextLength: 1000000, aliases: ["gx-1-fast-reasoning"] },
    { id: "grok-4.20-0309-non-reasoning", name: "Grok 4.20 Non-Reasoning", contextLength: 1000000, aliases: ["gx-1-fast-non-reasoning"] },
    { id: "grok-build-0.1", name: "Grok Build 0.1", contextLength: 256000, aliases: ["gx-build", "grok-code-fast-1"] },
    // `grok-4.20-multi-agent-0309` is deliberately absent: the vendor documents it as
    // "Responses API only. It does not work through Chat Completions."
  ],
  /** The live catalog is per key; keep the seed usable while discovering the rest. */
  modelsFetcher: {
    url: "https://api.grokified.com/v1/models",
    type: "openai",
    excludeIdPattern: "^(?:grok-imagine-|gx-(?:image|video)|claude-|grok-4\\.20-multi-agent-0309$|gx-1-fast-multi-agent$)",
  },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
