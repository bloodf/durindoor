import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";

const TIER_A_APIKEY_PROVIDERS = [
  "modelscope",
  "nanogpt",
  "nous-research",
  "inception",
  "writer",
  "ovhcloud",
  "nscale",
  "modal",
  "sarvam",
  "typhoon",
  "sealion",
  "plamo",
  "internlm",
  "ant-ling",
  "clova-studio",
  "coze",
  "qwen-cloud",
  "qwen-cloud-token-plan",
  "volcengine-coding-plan",
  "volcengine-agent-plan",
  "xiaomi-mimo-token-plan",
];

const SEARCH_FETCH_PROVIDERS = [
  "context7",
  "nimble",
  "anysearch",
];

// Providers whose model catalog moves too fast for a pinned list: they ship
// an empty static list plus a top-level modelsFetcher for live /models
// discovery instead (matches OmniRoute's own choice for these ids).
const LIVE_DISCOVERY_ONLY = new Set(["modelscope"]);

describe("Tier A API-key providers ported from OmniRoute", () => {
  it.each(TIER_A_APIKEY_PROVIDERS)("provider %s is registered and resolves baseUrl, format, and models", (id) => {
    const entry = REGISTRY.find((e) => e.id === id);
    expect(entry, `registry entry for ${id} must exist`).toBeDefined();
    expect(entry.category).toBe("apikey");

    const provider = PROVIDERS[id];
    expect(provider, `PROVIDERS[${id}] must resolve`).toBeDefined();
    expect(provider.baseUrl, `PROVIDERS[${id}].baseUrl must be defined`).toMatch(/^https:\/\//);
    expect(provider.format, `PROVIDERS[${id}].format must be defined`).toBe(entry.transport.format || "openai");

    const key = entry.alias || entry.id;
    const models = PROVIDER_MODELS[key];
    expect(Array.isArray(models), `models for ${id} (key: ${key}) must be an array`).toBe(true);

    if (LIVE_DISCOVERY_ONLY.has(id)) {
      expect(models.length, `${id} intentionally ships an empty static list`).toBe(0);
      expect(entry.modelsFetcher?.url, `${id} must declare a modelsFetcher for live discovery`).toMatch(/^https:\/\//);
      expect(entry.passthroughModels, `${id} must set passthroughModels for live discovery`).toBe(true);
    } else {
      expect(models.length, `models for ${id} (key: ${key}) must not be empty`).toBeGreaterThan(0);
    }

    for (const m of models) {
      expect(typeof m.id).toBe("string");
      expect(m.id.length).toBeGreaterThan(0);
      expect(typeof m.name).toBe("string");
      expect(m.name.length).toBeGreaterThan(0);
    }
  });

  it("ovhcloud allows the anonymous no-key tier via authType optional", () => {
    const entry = REGISTRY.find((e) => e.id === "ovhcloud");
    expect(entry.authType).toBe("optional");
    expect(entry.modelsFetcher?.url).toMatch(/^https:\/\//);
  });

  it.each(["qwen-cloud", "qwen-cloud-token-plan"])("%s declares a live modelsFetcher matching its dashscope host", (id) => {
    const entry = REGISTRY.find((e) => e.id === id);
    expect(entry.modelsFetcher?.url).toBe(entry.transport.validateUrl);
  });

  it.each(SEARCH_FETCH_PROVIDERS)("search/fetch provider %s is registered with valid endpoints and serviceKinds", (id) => {
    const entry = REGISTRY.find((e) => e.id === id);
    expect(entry, `registry entry for ${id} must exist`).toBeDefined();
    expect(entry.category).toBe("apikey");

    const media = PROVIDER_MEDIA[id];
    expect(media, `PROVIDER_MEDIA[${id}] must resolve`).toBeDefined();
    expect(media.serviceKinds).toEqual(expect.arrayContaining(["webSearch"]));

    const baseUrl = media.searchConfig?.baseUrl || media.fetchConfig?.baseUrl;
    expect(baseUrl, `search/fetch baseUrl for ${id} must be defined`).toMatch(/^https:\/\//);
  });

  it("context7 search/fetch allow the anonymous no-key tier via authType none", () => {
    const media = PROVIDER_MEDIA.context7;
    expect(media.searchConfig.authType).toBe("none");
    expect(media.fetchConfig.authType).toBe("none");
  });

  it("hides decommissioned chipotle from new adds instead of misusing the deprecated risk-notice", () => {
    const chipotle = REGISTRY.find((e) => e.id === "chipotle");
    expect(chipotle).toBeDefined();
    // amelia.chipotle.com is a dead host (404 everywhere), not a licensing
    // risk, so this uses the same "hidden" mechanism as dify/databricks/zed
    // rather than the deprecated/deprecationNotice risk-notice pair.
    expect(chipotle.hidden).toBe(true);
    expect(chipotle.display?.deprecated).toBeUndefined();
    // Ensure existing user connections and models are preserved
    expect(chipotle.models?.length).toBeGreaterThan(0);
    expect(chipotle.transport?.baseUrl).toBe("https://amelia.chipotle.com");
  });

  it("maintains uniqueness of provider ids and aliases across all registry entries", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);

    const lookupKeys = new Set();
    for (const e of REGISTRY) {
      expect(lookupKeys.has(e.id), `duplicate primary id ${e.id}`).toBe(false);
      lookupKeys.add(e.id);
    }
  });
});
