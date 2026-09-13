// Traffic "lanes": one provider account + model, with how its requests split
// across API keys, endpoints and combos. Every usage, log, request-detail and
// timeline fixture is derived from these so the pages tell one story.
import { API_KEYS, COMBOS, CONNECTIONS, connectionById } from "./world.js";

const MSG = "/v1/messages";
const CHAT = "/v1/chat/completions";
const RESP = "/v1/responses";

// mix entries: [apiKeyId | null (local, no key), endpoint, comboName | null, share]
const LANE_SPECS = [
  { connectionId: "conn-claude-balin", model: "claude-sonnet-5", weight: 24, prompt: 18000, completion: 1400, cache: 0.65,
    mix: [["key-workstation", MSG, null, 0.55], ["key-workstation", MSG, "daily-coder", 0.15], ["key-agents", MSG, "daily-coder", 0.2], [null, CHAT, null, 0.1]] },
  { connectionId: "conn-claude-balin", model: "claude-opus-5", weight: 8, prompt: 24000, completion: 2200, cache: 0.6,
    mix: [["key-workstation", MSG, null, 0.85], [null, MSG, null, 0.15]] },
  { connectionId: "conn-anthropic-team", model: "claude-sonnet-5", weight: 6, prompt: 9000, completion: 900, cache: 0.4,
    mix: [["key-workstation", MSG, null, 0.7], [null, CHAT, null, 0.3]] },
  { connectionId: "conn-anthropic-team", model: "claude-opus-5", weight: 3, prompt: 20000, completion: 1800, cache: 0.5,
    mix: [["key-agents", MSG, "vision-stack", 0.6], ["key-workstation", MSG, null, 0.4]] },
  { connectionId: "conn-codex-main", model: "gpt-6-astra", weight: 14, prompt: 22000, completion: 1900, cache: 0.55, reasoning: 0.35,
    mix: [["key-workstation", RESP, null, 0.55], ["key-workstation", RESP, "daily-coder", 0.15], ["key-agents", RESP, "daily-coder", 0.3]] },
  { connectionId: "conn-codex-main", model: "gpt-5.5", weight: 6, prompt: 12000, completion: 1100, cache: 0.45, reasoning: 0.25,
    mix: [["key-workstation", RESP, null, 0.8], ["key-workstation", CHAT, null, 0.2]] },
  { connectionId: "conn-codex-backup", model: "gpt-5.5", weight: 3, prompt: 12000, completion: 1100, cache: 0.45, reasoning: 0.25,
    mix: [["key-workstation", RESP, null, 1]] },
  { connectionId: "conn-gemini-cli", model: "gemini-3.1-pro-preview", weight: 5, prompt: 15000, completion: 1300, cache: 0.3, reasoning: 0.2,
    mix: [["key-workstation", CHAT, null, 0.5], ["key-agents", CHAT, "vision-stack", 0.5]] },
  { connectionId: "conn-gemini-cli", model: "gemini-3-flash-preview", weight: 5, prompt: 6000, completion: 700, cache: 0.2,
    mix: [["key-workstation", CHAT, null, 1]] },
  { connectionId: "conn-copilot", model: "gpt-5.4", weight: 7, prompt: 11000, completion: 1000, cache: 0.35,
    mix: [["key-workstation", CHAT, null, 0.6], ["key-workstation", CHAT, "daily-coder", 0.2], ["key-agents", CHAT, "daily-coder", 0.2]] },
  { connectionId: "conn-copilot", model: "gpt-5.3-codex", weight: 4, prompt: 13000, completion: 1200, cache: 0.35,
    mix: [["key-workstation", RESP, null, 1]] },
  { connectionId: "conn-antigravity", model: "gemini-3.8-flash-high", weight: 4, prompt: 8000, completion: 900, cache: 0.25, reasoning: 0.3,
    mix: [["key-agents", CHAT, "vision-stack", 0.5], ["key-workstation", CHAT, null, 0.5]] },
  // Paused five days ago: history only.
  { connectionId: "conn-kiro", model: "claude-opus-4.8", weight: 3, prompt: 20000, completion: 1800, cache: 0.5, activeUntilDaysAgo: 5,
    mix: [["key-workstation", MSG, null, 1]] },
  // Quota ran out three days ago: only failures since.
  { connectionId: "conn-cursor", model: "claude-4.5-sonnet", weight: 3, prompt: 14000, completion: 1200, cache: 0.4, activeUntilDaysAgo: 3,
    mix: [["key-workstation", CHAT, null, 1]] },
  { connectionId: "conn-groq", model: "openai/gpt-oss-120b", weight: 10, prompt: 3000, completion: 500, cache: 0,
    mix: [["key-ci", CHAT, "cheap-fallback", 0.75], ["key-workstation", CHAT, null, 0.25]] },
  { connectionId: "conn-openrouter", model: "deepseek/deepseek-v4-flash", weight: 3, prompt: 4000, completion: 600, cache: 0.1,
    mix: [["key-workstation", CHAT, null, 1]] },
  { connectionId: "conn-deepseek", model: "deepseek-v4-flash", weight: 6, prompt: 4000, completion: 600, cache: 0.3,
    mix: [["key-ci", CHAT, "cheap-fallback", 0.8], ["key-workstation", CHAT, null, 0.2]] },
  { connectionId: "conn-deepseek", model: "deepseek-v4-pro", weight: 3, prompt: 14000, completion: 1500, cache: 0.4, reasoning: 0.3,
    mix: [["key-agents", CHAT, "daily-coder", 0.5], ["key-workstation", CHAT, null, 0.5]] },
  { connectionId: "conn-ollama", model: "qwen3-coder:30b", weight: 5, prompt: 5000, completion: 700, cache: 0,
    mix: [["key-ci", CHAT, "cheap-fallback", 0.4], [null, CHAT, null, 0.6]] },
  { connectionId: "conn-ravenhill", model: "llama-4-maverick", weight: 3, prompt: 6000, completion: 800, cache: 0,
    mix: [[null, CHAT, null, 1]] },
];

// USD per million tokens [input, output]. Cached input bills at 10%.
const PRICING = {
  "claude-sonnet-5": [3, 15], "claude-opus-5": [5, 25], "claude-opus-4.8": [5, 25], "claude-4.5-sonnet": [3, 15],
  "gpt-6-astra": [5, 40], "gpt-5.5": [1.25, 10], "gpt-5.4": [1.25, 10], "gpt-5.3-codex": [1.25, 10],
  "gemini-3.1-pro-preview": [2, 12], "gemini-3-flash-preview": [0.3, 2.5], "gemini-3.8-flash-high": [0.3, 2.5],
  "openai/gpt-oss-120b": [0.15, 0.6], "deepseek/deepseek-v4-flash": [0.1, 0.4], "deepseek-v4-flash": [0.1, 0.4],
  "deepseek-v4-pro": [0.5, 2], "qwen3-coder:30b": [0, 0], "llama-4-maverick": [0, 0],
};

const CACHE_WRITE_PROVIDERS = new Set(["claude", "anthropic", "kiro"]);

export const LOCAL_KEY = Object.freeze({ id: "local-no-key", keyName: "Local (No API Key)", apiKeyMasked: null });

export const LANES = Object.freeze(
  LANE_SPECS.map((spec, index) => {
    const connection = connectionById(spec.connectionId);
    return Object.freeze({
      ...spec,
      index,
      provider: connection.provider,
      alias: connection.alias,
      accountName: connection.name || connection.email || connection.id,
      reasoning: spec.reasoning || 0,
      cacheWrite: CACHE_WRITE_PROVIDERS.has(connection.provider),
      pricing: PRICING[spec.model] || [1, 4],
    });
  }),
);

export function laneCost(lane, { promptTokens, completionTokens, cachedTokens }) {
  const [input, output] = lane.pricing;
  return ((promptTokens - cachedTokens) * input + cachedTokens * input * 0.1 + completionTokens * output) / 1e6;
}

export function comboByName(name) {
  return COMBOS.find((combo) => combo.name === name) || null;
}

export function apiKeyIdentity(apiKeyId) {
  const key = API_KEYS.find((item) => item.id === apiKeyId);
  return key ? { id: `api-key:${key.id}`, keyName: key.name, apiKeyMasked: "***" } : LOCAL_KEY;
}

export function apiKeyName(apiKeyId) {
  return apiKeyIdentity(apiKeyId).keyName;
}

export const PROVIDER_DISPLAY = Object.freeze(
  Object.fromEntries(CONNECTIONS.filter((c) => c.providerSpecificData?.nodeName).map((c) => [c.provider, c.providerSpecificData.nodeName])),
);

export function providerDisplay(provider) {
  return PROVIDER_DISPLAY[provider] || provider;
}

// Where a failing account lands in logs and traces.
export const FAILURES = Object.freeze({
  "conn-codex-backup": [{ status: 429, message: "Rate limit reached for gpt-5.5 (429)", share: 1 }],
  "conn-cursor": [
    { status: 500, message: "Upstream error: Monthly quota exhausted", share: 0.7 },
    { status: 429, message: "Too many requests, slow down", share: 0.3 },
  ],
});
