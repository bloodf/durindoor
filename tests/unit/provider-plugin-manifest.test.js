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
    category: "oauth",
    hasOAuth: true,
    transport: {
      baseUrl: "https://claude.ai/api/organizations",
      format: "openai",
      executor: "claude-web",
    },
    models: [{ id: "claude-sonnet-4.6", name: "Claude 4.6 Sonnet (web)" }],
  },
};

describe("provider plugin manifest", () => {
  it("generates sorted JSON-safe provider metadata", () => {
    const manifest = generateProviderPluginManifestFromRegistry(registryFixture);
    const roundTripped = JSON.parse(JSON.stringify(manifest));

    expect(roundTripped.schemaVersion).toBe(1);
    expect(roundTripped.generatedFrom).toBe("open-sse/providers/registry");
    expect(roundTripped.providers.map((provider) => provider.id)).toEqual(["claude-web", "openai"]);
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
});
