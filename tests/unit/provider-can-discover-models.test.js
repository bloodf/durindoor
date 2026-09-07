import { describe, expect, it } from "vitest";
import { canDiscoverModels } from "@/app/api/providers/route.js";

describe("canDiscoverModels", () => {
  it("returns false for an apikey connection with no key (QA OpenAI Main seed shape)", () => {
    // Mirrors tests/e2e/seeds.mjs: provider "openai", authType "apikey", no apiKey field.
    expect(canDiscoverModels({ provider: "openai", authType: "apikey" })).toBe(false);
  });

  it("returns true for an openai connection with an apiKey", () => {
    expect(canDiscoverModels({ provider: "openai", apiKey: "sk-test" })).toBe(true);
  });
  it("returns false for opencode-go (no PROVIDER_MODELS_CONFIG entry, no registry modelsFetcher)", () => {
    expect(canDiscoverModels({ provider: "opencode-go", apiKey: "any" })).toBe(false);
  });

  it("returns false for an openai-compatible connection missing baseUrl", () => {
    expect(canDiscoverModels({
      provider: "openai-compatible-node-1",
      apiKey: "sk-test",
      providerSpecificData: {},
    })).toBe(false);
  });

  it("returns false for an openai-compatible connection with baseUrl but no token", () => {
    expect(canDiscoverModels({
      provider: "openai-compatible-node-1",
      providerSpecificData: { baseUrl: "https://example.com/v1" },
    })).toBe(false);
  });

  it("returns true for an openai-compatible connection with baseUrl and apiKey", () => {
    expect(canDiscoverModels({
      provider: "openai-compatible-node-1",
      apiKey: "sk-test",
      providerSpecificData: { baseUrl: "https://example.com/v1" },
    })).toBe(true);
  });

  it("kimchi requires an accessToken or apiKey (kimchiModels.js readToken)", () => {
    expect(canDiscoverModels({ provider: "kimchi" })).toBe(false);
    expect(canDiscoverModels({ provider: "kimchi", apiKey: "k" })).toBe(true);
  });

  it("kiro requires an accessToken (kiroModels.js:417)", () => {
    expect(canDiscoverModels({ provider: "kiro" })).toBe(false);
    expect(canDiscoverModels({ provider: "kiro", accessToken: "a" })).toBe(true);
  });

  it("qoder requires accessToken AND providerSpecificData.userId (qoderModels.js:193-195)", () => {
    expect(canDiscoverModels({ provider: "qoder", accessToken: "a" })).toBe(false);
    expect(canDiscoverModels({
      provider: "qoder",
      accessToken: "a",
      providerSpecificData: { userId: "u1" },
    })).toBe(true);
  });

  it("returns false for gemini-cli/agy with only a refresh token (buildOAuthResolver 401s without accessToken)", () => {
    expect(canDiscoverModels({ provider: "gemini-cli", refreshToken: "r-token" })).toBe(false);
    expect(canDiscoverModels({ provider: "agy", refreshToken: "r-token" })).toBe(false);
  });

  it("returns true for gemini-cli/agy with a stored access token", () => {
    expect(canDiscoverModels({ provider: "gemini-cli", accessToken: "a-token" })).toBe(true);
    expect(canDiscoverModels({ provider: "agy", accessToken: "a-token" })).toBe(true);
  });

  it("github requires copilotToken or accessToken; refreshToken alone is not enough", () => {
    expect(canDiscoverModels({ provider: "github", refreshToken: "r-token" })).toBe(false);
    expect(canDiscoverModels({ provider: "github", accessToken: "a-token" })).toBe(true);
  });

  it("ollama-local needs no stored credential (local daemon auth)", () => {
    expect(canDiscoverModels({ provider: "ollama-local" })).toBe(true);
  });

  it("returns false for a plain config provider (claude) with no token", () => {
    expect(canDiscoverModels({ provider: "claude" })).toBe(false);
  });

  it("returns true for a plain config provider (claude) with an apiKey", () => {
    expect(canDiscoverModels({ provider: "claude", apiKey: "sk-ant-test" })).toBe(true);
  });
});
