import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const repoRoot = resolve(import.meta.dirname, "../..");

const providerFamilies = [
  {
    id: "adapta-web",
    alias: "adp-web",
    icon: "adapta-web",
    assetPath: resolve(repoRoot, "public/providers/adapta-web.png"),
    category: "apikey",
    format: "openai",
    baseUrl: "https://agent.adapta.one/api/chat/stream/v1",
    executor: "adapta-web",
    auth: { apiKey: { header: "Authorization", scheme: "bearer" } },
    models: [
      { id: "adapta-one", name: "Adapta ONE (Auto)" },
      { id: "adapta-gpt", name: "GPT-5 (via Adapta)" },
      { id: "adapta-claude", name: "Claude Sonnet 4.6 (via Adapta)" },
      { id: "adapta-gemini", name: "Gemini 2.5 Pro (via Adapta)" },
      { id: "adapta-grok", name: "Grok 4 (via Adapta)" },
      { id: "adapta-deepseek", name: "DeepSeek R2 (via Adapta)" },
      { id: "adapta-llama", name: "Llama 4 (via Adapta)" },
    ],
  },
  {
    id: "aimlapi",
    alias: "aiml",
    icon: "aimlapi",
    assetPath: resolve(repoRoot, "public/providers/aimlapi.png"),
    category: "apikey",
    format: "openai",
    baseUrl: "https://api.aimlapi.com/v1/chat/completions",
    executor: "default",
    auth: { apiKey: { header: "Authorization", scheme: "bearer" } },
    passthroughModels: true,
    models: [
      { id: "gpt-4o", name: "GPT-4o (via AI/ML API)" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet (via AI/ML API)" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro (via AI/ML API)" },
      { id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", name: "Llama 3.1 70B (via AI/ML API)" },
      { id: "deepseek-chat", name: "DeepSeek Chat (via AI/ML API)" },
      { id: "mistral-large-latest", name: "Mistral Large (via AI/ML API)" },
    ],
  },
  {
    id: "agentrouter",
    alias: "agentrouter",
    icon: "agentrouter",
    assetPath: resolve(repoRoot, "public/providers/agentrouter.png"),
    category: "apikey",
    format: "claude",
    baseUrl: "https://agentrouter.org/v1/messages",
    executor: "default",
    auth: {
      apiKey: { header: "x-api-key", scheme: "raw" },
      hooks: ["claudeOverlay"],
    },
    defaultContextLength: 128000,
    passthroughModels: true,
    models: [
      { id: "claude-opus-4-6", name: "Claude 4.6 Opus" },
      { id: "claude-haiku-4-5-20251001", name: "Claude 4.5 Haiku" },
      { id: "glm-5.1", name: "GLM 5.1" },
      { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
    ],
  },
];

describe("OmniRoute provider families — Adapta, AIMLAPI, AgentRouter", () => {
  for (const family of providerFamilies) {
    it(`maps ${family.id} registry entry to its OmniRoute source shape`, () => {
      const entry = REGISTRY.find((p) => p.id === family.id);
      expect(entry, `${family.id} registry entry`).toBeDefined();
      expect(entry.category, `${family.id} category`).toBe(family.category);
      expect(entry.alias, `${family.id} alias`).toBe(family.alias);
      expect(entry.display?.icon, `${family.id} display icon`).toBe(family.icon);
      expect(existsSync(family.assetPath), `${family.id} icon asset`).toBe(true);
      expect(entry.transport?.baseUrl, `${family.id} baseUrl`).toBe(family.baseUrl);
      expect(entry.transport?.executor ?? "default", `${family.id} executor`).toBe(family.executor);

      if (family.auth) {
        expect(entry.transport?.auth, `${family.id} auth`).toMatchObject(family.auth);
      }
      if (family.passthroughModels) {
        expect(entry.passthroughModels, `${family.id} passthroughModels`).toBe(true);
      }
      if (family.defaultContextLength) {
        expect(entry.transport?.defaultContextLength, `${family.id} defaultContextLength`).toBe(family.defaultContextLength);
      }

      expect(entry.models, `${family.id} models`).toEqual(family.models);
    });

    it(`builds ${family.id} runtime config from the registry`, () => {
      expect(PROVIDERS[family.id]?.format, `${family.id} runtime format`).toBe(family.format);
      expect(PROVIDERS[family.id]?.baseUrl, `${family.id} runtime baseUrl`).toBe(family.baseUrl);
      expect(PROVIDER_MODELS[family.alias]?.map((m) => ({ id: m.id, name: m.name })), `${family.id} PROVIDER_MODELS`).toEqual(family.models);
    });
  }

  it("AgentRouter uses dynamic claudeOverlay hook without static spoof headers", () => {
    const entry = REGISTRY.find((p) => p.id === "agentrouter");
    expect(entry.transport?.headers).toBeUndefined();
    expect(entry.transport?.auth?.hooks).toContain("claudeOverlay");

    const executor = new DefaultExecutor("agentrouter");
    const headers = executor.buildHeaders({ apiKey: "sk-agentrouter" }, false);
    expect(headers["x-api-key"]).toBe("sk-agentrouter");
    expect(headers.Authorization).toBeUndefined();
  });
});
