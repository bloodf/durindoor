// The shared demo world. Every fixture module references these ids so usage,
// timeline, keys, combos and providers all tell the same story.

export const OPERATOR = Object.freeze({ name: "Balin", email: "balin@erebor.dev" });
export const MACHINE_ID = "demo-machine";
export const LOCAL_PORT = 20128;
export const DEMO_VERSION = "4.2.1";

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

export function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}

export function isoAhead(ms) {
  return new Date(Date.now() + ms).toISOString();
}

// Deterministic pseudo-random numbers so generated series look stable.
export function seeded(seed = 42) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Provider connections (see src/lib/db/repos/connectionsRepo.js rowToConn).
// `models` lists what each account is used for in usage/timeline fixtures.
export const CONNECTIONS = Object.freeze([
  {
    id: "conn-claude-balin", provider: "claude", authType: "oauth", name: "balin@erebor.dev", email: "balin@erebor.dev",
    priority: 1, isActive: true, testStatus: "active", alias: "cc", models: ["claude-opus-5", "claude-sonnet-5"],
  },
  {
    id: "conn-anthropic-team", provider: "anthropic", authType: "apikey", name: "Erebor team key", email: null,
    priority: 1, isActive: true, testStatus: "active", alias: "anthropic", models: ["claude-sonnet-5", "claude-opus-5"],
  },
  {
    id: "conn-codex-main", provider: "codex", authType: "oauth", name: "balin@erebor.dev", email: "balin@erebor.dev",
    priority: 1, isActive: true, testStatus: "active", alias: "cx", models: ["gpt-6-astra", "gpt-5.5"],
  },
  {
    id: "conn-codex-backup", provider: "codex", authType: "oauth", name: "dwalin@erebor.dev", email: "dwalin@erebor.dev",
    priority: 2, isActive: true, testStatus: "unavailable", alias: "cx", models: ["gpt-5.5"],
    lastError: "Rate limit reached for gpt-5.5 (429)", lastErrorType: "rate_limit", errorCode: "429",
    rateLimited: true,
  },
  {
    id: "conn-gemini-cli", provider: "gemini-cli", authType: "oauth", name: "balin.gemini@gmail.com", email: "balin.gemini@gmail.com",
    priority: 1, isActive: true, testStatus: "active", alias: "gc", models: ["gemini-3.1-pro-preview", "gemini-3-flash-preview"],
  },
  {
    id: "conn-copilot", provider: "github", authType: "oauth", name: "balin-oakenshield", email: "balin@erebor.dev",
    priority: 1, isActive: true, testStatus: "active", alias: "gh", models: ["gpt-5.4", "gpt-5.3-codex"],
  },
  {
    id: "conn-antigravity", provider: "antigravity", authType: "oauth", name: "balin@erebor.dev", email: "balin@erebor.dev",
    priority: 1, isActive: true, testStatus: "active", alias: "ag", models: ["gemini-3.8-flash-high"],
  },
  {
    id: "conn-kiro", provider: "kiro", authType: "oauth", name: "Kiro (Builder ID)", email: "balin@erebor.dev",
    priority: 1, isActive: false, testStatus: "active", alias: "kr", models: ["claude-opus-4.8"], paused: true,
  },
  {
    id: "conn-cursor", provider: "cursor", authType: "oauth", name: "balin@erebor.dev", email: "balin@erebor.dev",
    priority: 1, isActive: true, testStatus: "error", alias: "cu", models: ["claude-4.5-sonnet"],
    lastError: "Monthly quota exhausted", lastErrorType: "quota_exceeded", errorCode: "402",
  },
  {
    id: "conn-groq", provider: "groq", authType: "apikey", name: "Groq free tier", email: null,
    priority: 1, isActive: true, testStatus: "active", alias: "groq", models: ["openai/gpt-oss-120b"],
  },
  {
    id: "conn-openrouter", provider: "openrouter", authType: "apikey", name: "OpenRouter", email: null,
    priority: 1, isActive: true, testStatus: "active", alias: "openrouter", models: ["deepseek/deepseek-v4-flash"],
  },
  {
    id: "conn-deepseek", provider: "deepseek", authType: "apikey", name: "DeepSeek platform", email: null,
    priority: 1, isActive: true, testStatus: "active", alias: "deepseek", models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  {
    id: "conn-ollama", provider: "ollama-local", authType: "apikey", name: "Ollama on forge", email: null,
    priority: 1, isActive: true, testStatus: "active", alias: "ollama-local", models: ["qwen3-coder:30b"],
    providerSpecificData: { baseUrl: "http://localhost:11434" },
  },
  {
    id: "conn-ravenhill", provider: "openai-compatible-ravenhill", authType: "apikey", name: "Ravenhill vLLM", email: null,
    priority: 1, isActive: true, testStatus: "active", alias: "ravenhill", models: ["llama-4-maverick"],
    providerSpecificData: { baseUrl: "https://llm.ravenhill.internal/v1", nodeName: "Ravenhill vLLM", prefix: "ravenhill", apiType: "chat" },
  },
]);

export const PROVIDER_NODES = Object.freeze([
  {
    id: "openai-compatible-ravenhill", type: "openai-compatible", name: "Ravenhill vLLM", prefix: "ravenhill",
    apiType: "chat", baseUrl: "https://llm.ravenhill.internal/v1",
  },
]);

// Combos (see src/lib/db/repos/combosRepo.js rowToCombo).
export const COMBOS = Object.freeze([
  { id: "combo-daily-coder", name: "daily-coder", kind: "llm", models: ["cc/claude-sonnet-5", "cx/gpt-6-astra", "gh/gpt-5.4", "deepseek/deepseek-v4-pro"] },
  { id: "combo-cheap-fallback", name: "cheap-fallback", kind: "llm", models: ["groq/openai/gpt-oss-120b", "deepseek/deepseek-v4-flash", "ollama-local/qwen3-coder:30b"] },
  { id: "combo-vision-stack", name: "vision-stack", kind: "llm", models: ["gc/gemini-3.1-pro-preview", "ag/gemini-3.8-flash-high", "anthropic/claude-opus-5"] },
]);

// Model aliases map alias -> "provider-alias/model" (src/lib/db/repos/aliasRepo.js).
export const MODEL_ALIASES = Object.freeze({
  "daily-coder": "cc/claude-sonnet-5",
  fast: "groq/openai/gpt-oss-120b",
  thinker: "cx/gpt-6-astra",
});

// API keys (see src/lib/db/repos/apiKeysRepo.js rowToKey).
export const API_KEYS = Object.freeze([
  {
    id: "key-workstation", name: "Balin workstation", key: "sk-dd-7f3a9c1e5b2d4a6f8e0c1b3d5f7a9c2e", allowedCombos: [],
    dailyLimitTokens: null, isActive: true, usage: { requests: 8421, tokens: 18_450_210, cost: 142.37 },
  },
  {
    id: "key-ci", name: "CI pipeline", key: "sk-dd-2b4d6f8a0c1e3a5c7e9b1d3f5a7c9e1b", allowedCombos: ["cheap-fallback"],
    dailyLimitTokens: 2_000_000, isActive: true, usage: { requests: 3190, tokens: 4_120_880, cost: 9.84 },
  },
  {
    id: "key-agents", name: "Night agents", key: "sk-dd-9e1c3a5f7b9d1f3b5d7f9a1c3e5b7d9f", allowedCombos: ["daily-coder", "vision-stack"],
    dailyLimitTokens: 5_000_000, isActive: true, usage: { requests: 1204, tokens: 6_902_144, cost: 61.05 },
  },
]);

export const PROXY_POOLS = Object.freeze([
  { id: "pool-erebor", name: "Erebor egress", proxyUrl: "http://proxy.erebor.internal:3128", noProxy: "localhost,127.0.0.1", isActive: true, strictProxy: false, testStatus: "active" },
  { id: "pool-dale", name: "Dale residential", proxyUrl: "socks5://dale-gw.example.net:1080", noProxy: "", isActive: true, strictProxy: true, testStatus: "active" },
]);

export function connectionById(id) {
  return CONNECTIONS.find((connection) => connection.id === id) || null;
}
