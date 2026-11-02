import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// OmniRoute ports: tokenreply (#1239), uc-direct (#1242), unifically (#1243), unorouter (#1244).
const CASES = [
  {
    "id": "tokenreply",
    "alias": "tokenreply",
    "chat": "https://api.tokenreply.com/v1/chat/completions",
    "val": "https://api.tokenreply.com/v1/models",
    "models": [],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "uc-direct",
    "alias": "ucd",
    "chat": "https://api.uncensored.com/api/v1/chat/completions",
    "val": "https://api.uncensored.com/api/v1/models",
    "models": [
      "claude-opus-5",
      "claude-opus-5-fast",
      "claude-fable-5",
      "claude-opus-4.8",
      "claude-opus-4.5",
      "claude-sonnet-4.5",
      "claude-haiku-4.5",
      "claude-opus-4.7",
      "claude-opus-4.6",
      "claude-sonnet-4.6",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.3-codex",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-pro",
      "gpt-5.4-nano",
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5-mini",
      "gpt-5-nano",
      "openai-gpt-oss-120b",
      "gemini-3-6-flash",
      "gemini-3-flash-preview",
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemma-3-27b-it",
      "grok-4-6",
      "grok-4.5",
      "grok-4.20-beta",
      "grok-4.3",
      "deepseek-v4-flash-0731",
      "deepseek-v3.2",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-r1",
      "qwen-3-8-2-4t-a95b",
      "qwen-3-8-max",
      "qwen-3-6-35b-a3b",
      "qwen3-235b-a22b-2507",
      "qwen3-235b-a22b-thinking-2507",
      "qwen3.5-397b-a17b",
      "qwen3.6-27b",
      "qwen3-30b-a3b",
      "qwen3-5-35b-a3b",
      "qwen3-5-9b",
      "qwen3-coder",
      "qwen3-next-80b-a3b-instruct",
      "qwen3-vl-235b-a22b-thinking",
      "qwen3-vl-30b-a3b-thinking",
      "qwen3.5-flash",
      "qwen3.5-plus",
      "kimi-k3",
      "kimi-k2",
      "kimi-k2.5",
      "kimi-k2.6",
      "kimi-k2-thinking",
      "glm-5.2",
      "glm-4.7-flash",
      "glm-5",
      "glm-5.1",
      "glm-4.7",
      "glm-4.6",
      "minimax-m2.1",
      "minimax-m2.5",
      "minimax-m2.7",
      "mistral-large",
      "mistral-small-3.2-24b-instruct",
      "llama-3.2-3b-instruct",
      "llama-3.3-70b-instruct",
      "nvidia-nemotron-3-5-lightning-30b-a3b",
      "nvidia-nemotron-3-nano-30b-a3b",
      "hermes-3-llama-3.1-405b",
      "aion-labs.aion-2-0",
      "inkling"
    ],
    "fetcher": true,
    "xkey": true
  },
  {
    "id": "unifically",
    "alias": "unifically",
    "chat": "https://api.unifically.com/v1/chat/completions",
    "val": "https://api.unifically.com/v1/models?category=llm",
    "models": [],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "unorouter",
    "alias": "unorouter",
    "chat": "https://api.unorouter.com/v1/chat/completions",
    "val": "https://api.unorouter.com/v1/models",
    "models": [],
    "fetcher": true,
    "xkey": false
  }
];

describe.each(CASES)("$id provider", ({ id, alias, chat, val, models, fetcher, ua, xkey }) => {
  const entry = REGISTRY.find((e) => e.id === id);

  it("registers an API-key OpenAI-compatible transport", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(PROVIDERS[id]).toMatchObject({ baseUrl: chat, validateUrl: val, format: "openai", authType: "apikey" });
    if (ua) expect(PROVIDERS[id].headers["User-Agent"]).toBe(ua);
    if (xkey) expect(PROVIDERS[id].auth).toMatchObject({ header: "x-api-key", scheme: "raw" });
  });

  it("seeds only sourced models", () => {
    expect((PROVIDER_MODELS[alias] ?? []).map((m) => m.id)).toEqual(models);
    expect(PROVIDER_MEDIA[id].serviceKinds).toEqual(["llm"]);
    expect(PROVIDER_MEDIA[id].modelsFetcher ?? null).toEqual(fetcher ? { url: val, type: "openai" } : null);
  });

  it("resolves its alias", () => {
    expect(resolveProviderAlias(alias)).toBe(id);
  });
});

it("keeps every registry id unique", () => {
  const ids = REGISTRY.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
});
