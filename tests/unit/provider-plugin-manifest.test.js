import { describe, expect, it } from "vitest";
import {
  generateProviderPluginManifestFromRegistry,
  getProviderPluginManifestEntryFromRegistry,
} from "../../open-sse/config/providerPluginManifest.js";

const registryFixture = {
  openai: {
    id: "openai",
    alias: "openai",
    category: "apikey",
    transport: {
      baseUrl: "https://api.openai.com/v1/chat/completions",
      format: "openai",
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [
      { id: "gpt-4.1", name: "GPT-4.1", contextLength: 1047576 },
      { id: "o3", name: "O3", unsupportedParams: ["temperature"] },
    ],
  },
  "claude-web": {
    id: "claude-web",
    alias: "cw",
    aliases: ["cwa", "claude"],
    category: "oauth",
    hasOAuth: true,
    transport: {
      baseUrl: "https://claude.ai/api/organizations",
      format: "openai",
      executor: "claude-web",
    },
    models: [{ id: "claude-sonnet-4.6", name: "Claude 4.6 Sonnet (web)" }],
  },
  "cloudflare-ai": {
    id: "cloudflare-ai",
    alias: "cf",
    aliases: ["cf", "cloudflare"],
    category: "freeTier",
    authModes: ["apikey"],
    transport: {
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct",
      format: "openai",
    },
    models: [{ id: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct" }],
  },
  gemini: {
    id: "gemini",
    alias: "gemini",
    category: "freeTier",
    authModes: ["apikey"],
    transport: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
      format: "gemini",
    },
    models: [{ id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" }],
  },
  openrouter: {
    id: "openrouter",
    alias: "or",
    aliases: ["or"],
    category: "freeTier",
    authModes: ["apikey"],
    transport: {
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
      format: "openai",
    },
    models: [{ id: "openai/gpt-4o-mini-tts", name: "GPT-4o mini TTS" }],
  },
  "oauth-only": {
    id: "oauth-only",
    alias: "oo",
    category: "oauth",
    authModes: ["oauth"],
    transport: {
      baseUrl: "https://oauth-only.example/v1/chat/completions",
      format: "openai",
    },
    models: [{ id: "oo-model", name: "OAuth-only model" }],
  },
  "no-auth": {
    id: "no-auth",
    alias: "na",
    noAuth: true,
    transport: {
      baseUrl: "https://no-auth.example/v1/chat/completions",
      format: "openai",
    },
    models: [{ id: "na-model", name: "No-auth model" }],
  },
};

describe("provider plugin manifest", () => {
  it("generates sorted JSON-safe provider metadata", () => {
    const manifest = generateProviderPluginManifestFromRegistry(registryFixture);
    const roundTripped = JSON.parse(JSON.stringify(manifest));

    expect(roundTripped.schemaVersion).toBe(1);
    expect(roundTripped.generatedFrom).toBe("open-sse/providers/registry");
    expect(roundTripped.providers.map((provider) => provider.id)).toEqual([
      "cloudflare-ai",
      "claude-web",
      "gemini",
      "no-auth",
      "oauth-only",
      "openai",
      "openrouter",
    ]);
    expect(JSON.stringify(roundTripped)).not.toContain("clientSecret");
  });

  it("marks API-key default-executor static endpoints as sidecar candidates", () => {
    const entry = getProviderPluginManifestEntryFromRegistry(registryFixture, "openai");

    expect(entry.sidecar.eligible).toBe(true);
    expect(entry.capabilities).toContain("apikey");
    expect(entry.capabilities).toContain("sidecar-candidate");
    expect(entry.endpoints.baseUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(entry.models.find((model) => model.id === "gpt-4.1")).toMatchObject({
      contextLength: 1047576,
    });
  });

  it("keeps custom OAuth executors on the JS fallback path", () => {
    const entry = getProviderPluginManifestEntryFromRegistry(registryFixture, "cw");

    expect(entry.id).toBe("claude-web");
    expect(entry.sidecar.eligible).toBe(false);
    expect(entry.capabilities).toContain("custom-executor");
    expect(entry.sidecar.reasons.join(" ")).toContain("claude-web");
  });

  it("derives auth type from actual credential requirements, not category", () => {
    const manifest = generateProviderPluginManifestFromRegistry(registryFixture);
    const byId = Object.fromEntries(manifest.providers.map((p) => [p.id, p]));

    expect(byId["no-auth"].auth.type).toBe("none");
    expect(byId.openai.auth.type).toBe("apikey");
    expect(byId.gemini.auth.type).toBe("apikey");
    expect(byId.openrouter.auth.type).toBe("apikey");
    expect(byId["cloudflare-ai"].auth.type).toBe("apikey");
    expect(byId["claude-web"].auth.type).toBe("oauth");
    expect(byId["oauth-only"].auth.type).toBe("oauth");
  });

  it("excludes providers with templated URLs from sidecar eligibility", () => {
    const entry = getProviderPluginManifestEntryFromRegistry(registryFixture, "cloudflare-ai");

    expect(entry.sidecar.eligible).toBe(false);
    expect(entry.sidecar.reasons.some((reason) => reason.includes("templated"))).toBe(true);
  });

  it("exposes secondary aliases in addition to the primary alias", () => {
    const manifest = generateProviderPluginManifestFromRegistry(registryFixture);
    const claudeWeb = manifest.providers.find((p) => p.id === "claude-web");
    const openrouter = manifest.providers.find((p) => p.id === "openrouter");

    expect(claudeWeb.alias).toBe("cw");
    expect(claudeWeb.aliases).toEqual(["cwa", "claude"]);
    expect(openrouter.alias).toBe("or");
    expect(openrouter.aliases).toEqual(["or"]);
  });
});
