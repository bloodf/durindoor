import { describe, expect, it, vi } from "vitest";

// Port of 9router PR #5039 (feat(providers): add DotHoosh provider), the
// DotHoosh side of issue #1072.
//
// DotHoosh is an Iranian AI gateway that is OpenAI- and Anthropic-compatible:
// one API key reaches OpenAI Chat Completions, OpenAI Responses and Anthropic
// Messages. The endpoints, the auth scheme per path and the two model
// listings come from the provider's own documentation
// (https://gateway.dothoosh.com/docs, /docs/openai, /docs/anthropic,
// /docs/models):
//
//   POST /v1/chat/completions    Authorization: Bearer <key>
//   POST /v1/responses            Authorization: Bearer <key>
//   POST /anthropic/v1/messages   x-api-key: <key> + anthropic-version: 2023-06-01
//   GET  /v1/models               dynamic listing (public without a key)
//   GET  /anthropic/v1/models     the listing of the Anthropic path
//
// The listing rows are fixtures (tests/unit/fixtures/dothoosh-listings.json),
// so no test touches the network.

const routedFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({})),
  getCombos: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getCustomModels: vi.fn(async () => []),
  getSyncedModelCatalog: vi.fn(async () => null),
  getSyncedModelCatalogs: vi.fn(async () => ({})),
  saveSyncedModelCatalog: vi.fn(),
  getProviderNodes: vi.fn(async () => []),
  getProviderNodeById: vi.fn(async () => null),
  getProxyPoolById: vi.fn(async () => null),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => null),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: routedFetch }));
vi.mock("@/sse/services/tokenRefresh", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  refreshGoogleToken: vi.fn(),
  refreshCodexToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { getModelSupportedFormats, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";
import {
  DOTHOOSH_ANTHROPIC_MODELS_URL,
  DOTHOOSH_BASE_URL,
  DOTHOOSH_CHAT_COMPLETIONS_URL,
  DOTHOOSH_MESSAGES_URL,
  DOTHOOSH_OPENAI_MODELS_URL,
  DOTHOOSH_RESPONSES_URL,
  dothooshFamilyFormats,
  dotHooshListingHeaders,
  mergeDotHooshListings
} from "../../open-sse/providers/dothooshCatalog.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { canDiscoverModels } from "@/app/api/providers/route.js";
import { isModelAutoSyncEligible } from "@/lib/modelAutoSync/runner.js";
import { isAllowedSuggestedModelsFetcher } from "@/app/api/providers/suggested-models/route.js";
import fixture from "./fixtures/dothoosh-listings.json";

const entry = REGISTRY.find((provider) => provider.id === "dothoosh");
const KEY = "dh_test_key";

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: "",
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const dispatch = (model, sourceFormat) => resolveRequestTransport({
  provider: "dothoosh",
  alias: "dothoosh",
  model,
  sourceFormat,
  credentials: { apiKey: KEY },
  body: null
});

const headersFor = (format) => new DefaultExecutor("dothoosh").buildHeaders(
  { apiKey: KEY, runtimeTransport: resolveTransport("dothoosh", format) },
  true,
  undefined,
  "claude-fixture-opus-9",
  {}
);

describe("DotHoosh registry entry", () => {
  it("is registered as an API-key provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("dothoosh");
    expect(entry.aliases).toContain("dh");
    expect(entry.display.name).toBe("DotHoosh");
    // Provider-facing strings are English like every other registry entry.
    expect(entry.display.notice.text).not.toMatch(/[\u0600-\u06FF]/);
  });

  it("keeps every registry id unique after adding dothoosh", () => {
    const ids = REGISTRY.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points at the documented OpenAI-compatible endpoints", () => {
    expect(PROVIDERS.dothoosh.baseUrl).toBe(DOTHOOSH_CHAT_COMPLETIONS_URL);
    expect(PROVIDERS.dothoosh.validateUrl).toBe(DOTHOOSH_OPENAI_MODELS_URL);
    expect(PROVIDERS.dothoosh.format).toBe("openai");
    // A provider-wide thinkingFormat would force one wire format onto every
    // model; each model resolves its own through providers/capabilities.js.
    expect(PROVIDERS.dothoosh.thinkingFormat).toBeUndefined();
  });

  it("hard-codes no model list: the provider listing is the only source", () => {
    expect(entry.models).toBeUndefined();
    expect(PROVIDER_MODELS.dothoosh).toBeUndefined();
    expect(entry.passthroughModels).toBe(true);
  });

  it("declares its catalogue so the dashboard and the sync service agree", () => {
    expect(entry.modelsFetcher).toEqual({ url: DOTHOOSH_OPENAI_MODELS_URL, type: "openai" });
    // The keyless suggestion route only accepts a registered fetcher.
    expect(isAllowedSuggestedModelsFetcher(DOTHOOSH_OPENAI_MODELS_URL, "openai")).toBe(true);
    // The listing is readable, so the provider is listable for a connection
    // that carries a key.
    expect(canDiscoverModels({ provider: "dothoosh", apiKey: KEY })).toBe(true);
    expect(canDiscoverModels({ provider: "dothoosh" })).toBe(false);
    // The existing model auto-sync service refreshes it; no new job is added.
    expect(isModelAutoSyncEligible("dothoosh")).toBe(true);
  });
});

describe("DotHoosh transports and auth", () => {
  it("serves Chat Completions with the bearer scheme", () => {
    const transport = resolveTransport("dothoosh", "openai");
    expect(transport.baseUrl).toBe(DOTHOOSH_CHAT_COMPLETIONS_URL);
    expect(transport.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
  });

  it("serves the Responses API with the bearer scheme", () => {
    const transport = resolveTransport("dothoosh", "openai-responses");
    expect(transport.baseUrl).toBe(DOTHOOSH_RESPONSES_URL);
    expect(transport.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
  });

  it("serves Anthropic Messages with x-api-key only", () => {
    const transport = resolveTransport("dothoosh", "claude");
    expect(transport.baseUrl).toBe(DOTHOOSH_MESSAGES_URL);
    expect(transport.auth).toMatchObject({
      header: "x-api-key",
      scheme: "raw",
      anthropicVersion: true
    });
  });

  it("sends only x-api-key and the pinned anthropic-version on the claude lane", () => {
    // The provider rejects a request that carries both auth headers.
    const headers = headersFor("claude");
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers).not.toHaveProperty("Authorization");
    expect(headers).not.toHaveProperty("authorization");
    expect(headers).not.toHaveProperty("Anthropic-Beta");
    expect(headers).not.toHaveProperty("anthropic-beta");
  });

  it("sends the bearer header on the OpenAI lanes", () => {
    expect(headersFor("openai").Authorization).toBe(`Bearer ${KEY}`);
    expect(headersFor("openai-responses").Authorization).toBe(`Bearer ${KEY}`);
  });
});

describe("DotHoosh listing merge", () => {
  const merged = mergeDotHooshListings({
    openai: fixture.openai.data,
    anthropic: fixture.anthropic.data
  });
  const row = (id) => merged.find((model) => model.id === id);

  it("lists a model that only the Anthropic path serves", () => {
    expect(row("claude-fixture-opus-9")).toMatchObject({
      id: "claude-fixture-opus-9",
      name: "Claude Fixture Opus 9",
      contextLength: 1000000,
      maxOutput: 64000,
      supportedFormats: ["claude"]
    });
  });

  it("merges a model listed on both paths and keeps the OpenAI row's metadata", () => {
    expect(row("deepseek-fixture-flash")).toMatchObject({
      id: "deepseek-fixture-flash",
      name: "DeepSeek Fixture Flash",
      contextLength: 128000,
      maxOutput: 32768,
      supportedFormats: ["openai", "claude"]
    });
  });

  it("reads the lanes a model is served on from the listing protocols", () => {
    expect(row("gpt-fixture-astra").supportedFormats).toEqual(["openai", "openai-responses"]);
    // A model verified for the Responses path only never reaches Chat Completions.
    expect(row("gpt-fixture-terra").supportedFormats).toEqual(["openai-responses"]);
    expect(row("gemini-fixture-flash").supportedFormats).toEqual(["openai"]);
    expect(row("kimi-fixture-k3").supportedFormats).toEqual(["openai"]);
  });

  it("carries the live limits and the vision flag", () => {
    expect(row("gpt-fixture-astra")).toMatchObject({
      contextLength: 400000,
      maxOutput: 128000
    });
    expect(row("gpt-fixture-terra").vision).toBe(true);
    expect(row("gpt-fixture-astra").vision).toBe(false);
  });

  it("drops unusable rows and rows without limits", () => {
    expect(merged.some((model) => model.id === "")).toBe(false);
    expect(merged.some((model) => !model.id)).toBe(false);
    expect(row("no-limits-fixture")).toMatchObject({ id: "no-limits-fixture" });
    expect(row("no-limits-fixture").contextLength).toBeUndefined();
    expect(row("no-limits-fixture").maxOutput).toBeUndefined();
  });

  it("survives a listing that is missing or empty", () => {
    expect(mergeDotHooshListings({ openai: [], anthropic: [] })).toEqual([]);
    expect(mergeDotHooshListings({})).toEqual([]);
    expect(mergeDotHooshListings({ openai: undefined, anthropic: undefined })).toEqual([]);
  });

  it("uses the listing's own auth scheme", () => {
    expect(dotHooshListingHeaders("openai", KEY)).toMatchObject({
      Authorization: `Bearer ${KEY}`
    });
    expect(dotHooshListingHeaders("openai", KEY)).not.toHaveProperty("x-api-key");
    expect(dotHooshListingHeaders("anthropic", KEY)).toMatchObject({
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01"
    });
    expect(dotHooshListingHeaders("anthropic", KEY)).not.toHaveProperty("Authorization");
  });
});

describe("DotHoosh model listing import", () => {
  it("reads both provider listings and merges them into one catalog", async () => {
    routedFetch.mockReset();
    routedFetch.mockImplementation(async (url) => {
      if (url === DOTHOOSH_OPENAI_MODELS_URL) return json(fixture.openai);
      if (url === DOTHOOSH_ANTHROPIC_MODELS_URL) return json(fixture.anthropic);
      throw new Error(`unexpected request to ${url}`);
    });

    const result = await fetchConnectionModels({
      id: 11,
      provider: "dothoosh",
      apiKey: KEY,
      providerSpecificData: {}
    });

    expect(result.error).toBeUndefined();
    const ids = result.models.map((model) => model.id);
    expect(ids).toContain("claude-fixture-opus-9");
    expect(ids).toContain("gpt-fixture-astra");
    expect(ids).toContain("deepseek-fixture-flash");
    // The Claude-only model is served by the Anthropic lane.
    expect(result.models.find((model) => model.id === "claude-fixture-opus-9").supportedFormats)
      .toEqual(["claude"]);
  });

  it("keeps the key on the provider host and uses the scheme of each listing", async () => {
    routedFetch.mockReset();
    routedFetch.mockImplementation(async (url) => {
      if (url === DOTHOOSH_OPENAI_MODELS_URL) return json(fixture.openai);
      if (url === DOTHOOSH_ANTHROPIC_MODELS_URL) return json(fixture.anthropic);
      throw new Error(`unexpected request to ${url}`);
    });

    await fetchConnectionModels({
      id: 12,
      provider: "dothoosh",
      apiKey: KEY,
      providerSpecificData: {}
    });

    expect(routedFetch).toHaveBeenCalledTimes(2);
    const origin = new URL(DOTHOOSH_BASE_URL).origin;
    for (const [url, options] of routedFetch.mock.calls) {
      // The key never leaves the configured provider host.
      expect(new URL(url).origin).toBe(origin);
      const headerValues = Object.values(options.headers || {}).join(" ");
      expect(headerValues).toContain(KEY);
    }
    const [openaiCall, anthropicCall] = routedFetch.mock.calls;
    expect(openaiCall[0]).toBe(DOTHOOSH_OPENAI_MODELS_URL);
    expect(openaiCall[1].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(openaiCall[1].headers["x-api-key"]).toBeUndefined();
    expect(anthropicCall[0]).toBe(DOTHOOSH_ANTHROPIC_MODELS_URL);
    expect(anthropicCall[1].headers["x-api-key"]).toBe(KEY);
    expect(anthropicCall[1].headers.Authorization).toBeUndefined();
  });

  it("reports a rejected key instead of an empty catalog", async () => {
    routedFetch.mockReset();
    routedFetch.mockResolvedValue(json({ error: { message: "invalid api key" } }, 401));

    const result = await fetchConnectionModels({
      id: 13,
      provider: "dothoosh",
      apiKey: KEY,
      providerSpecificData: {}
    });

    expect(result.error).toBe("Invalid API key");
    expect(result.status).toBe(401);
  });
});

describe("DotHoosh dispatch", () => {
  it("keeps a Claude model on the Anthropic lane for an Anthropic client", () => {
    const { runtimeTransport, targetFormat } = dispatch("claude-fixture-opus-9", "claude");
    expect(runtimeTransport.baseUrl).toBe(DOTHOOSH_MESSAGES_URL);
    expect(targetFormat).toBe("claude");
  });

  it("sends a Claude model to the Anthropic lane even for an OpenAI client", () => {
    // The model is not served on Chat Completions, so the request is
    // translated to the Anthropic wire format instead of failing upstream.
    const { runtimeTransport, targetFormat } = dispatch("claude-fixture-opus-9", "openai");
    expect(runtimeTransport.baseUrl).toBe(DOTHOOSH_MESSAGES_URL);
    expect(targetFormat).toBe("claude");
  });

  it("sends a GPT model to Chat Completions for an OpenAI client", () => {
    const { runtimeTransport, targetFormat } = dispatch("gpt-fixture-astra", "openai");
    expect(runtimeTransport.baseUrl).toBe(DOTHOOSH_CHAT_COMPLETIONS_URL);
    expect(targetFormat).toBe("openai");
  });

  it("sends a GPT model to the Responses API for a Responses client", () => {
    const { runtimeTransport, targetFormat } = dispatch("gpt-fixture-astra", "openai-responses");
    expect(runtimeTransport.baseUrl).toBe(DOTHOOSH_RESPONSES_URL);
    expect(targetFormat).toBe("openai-responses");
  });

  it("keeps a DeepSeek model on the lanes it is served on", () => {
    expect(dispatch("deepseek-fixture-flash", "openai").runtimeTransport.baseUrl)
      .toBe(DOTHOOSH_CHAT_COMPLETIONS_URL);
    expect(dispatch("deepseek-fixture-flash", "claude").runtimeTransport.baseUrl)
      .toBe(DOTHOOSH_MESSAGES_URL);
  });

  it("keeps an unknown model on Chat Completions", () => {
    const { runtimeTransport, targetFormat } = dispatch("brand-new-model", "openai");
    expect(runtimeTransport.baseUrl).toBe(DOTHOOSH_CHAT_COMPLETIONS_URL);
    expect(targetFormat).toBe("openai");
  });

  it("declares the lanes of each model family", () => {
    expect(getModelSupportedFormats("dothoosh", "claude-fixture-opus-9")).toEqual(["claude"]);
    expect(getModelTargetFormat("dothoosh", "claude-fixture-opus-9")).toBe("claude");
    expect(getModelSupportedFormats("dothoosh", "deepseek-fixture-flash")).toEqual(["openai", "claude"]);
    expect(getModelSupportedFormats("dothoosh", "gpt-fixture-astra")).toEqual(["openai", "openai-responses"]);
    expect(getModelSupportedFormats("dothoosh", "gemini-fixture-flash")).toEqual(["openai"]);
    expect(getModelSupportedFormats("dothoosh", "kimi-fixture-k3")).toEqual(["openai"]);
    // The alias resolves like the provider id.
    expect(getModelSupportedFormats("dh", "claude-fixture-opus-9")).toEqual(["claude"]);
    // A thinking suffix does not change the lane.
    expect(getModelSupportedFormats("dothoosh", "claude-fixture-opus-9(high)")).toEqual(["claude"]);
    // An id no family claims never reaches the Anthropic-only lane.
    expect(getModelSupportedFormats("dothoosh", "brand-new-model")).toEqual(["openai"]);
    expect(getModelTargetFormat("dothoosh", "brand-new-model")).toBeFalsy();
  });

  it("falls back to the family table for ids the listing does not carry", () => {
    expect(dothooshFamilyFormats("claude-future-9")).toMatchObject({
      supportedFormats: ["claude"],
      targetFormat: "claude"
    });
    expect(dothooshFamilyFormats("gpt-future-9").supportedFormats).toEqual(["openai", "openai-responses"]);
    expect(dothooshFamilyFormats("unknown-family-9").supportedFormats).toEqual(["openai"]);
    expect(dothooshFamilyFormats("")).toBeNull();
  });
});
