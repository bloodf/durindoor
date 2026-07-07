import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MEDIA, PROVIDER_MODELS, PROVIDERS } from "../../open-sse/providers/index.js";

const repoRoot = resolve(import.meta.dirname, "../..");

const ownedProviderIds = [
  "crof",
  "databricks",
  "deepinfra",
  "dgrid",
  "dify",
  "dit",
  "doubao",
  "factory",
  "featherless-ai",
  "freeaiapikey",
  "freemodel-dev",
  "friendliai",
  "galadriel",
  "gigachat",
  "gitlawb",
  "glhf",
];

const expectedTransports = {
  crof: { baseUrl: "https://crof.ai/v1/chat/completions", authHeader: "bearer" },
  databricks: {
    baseUrl: "https://adb-0000000000000000.0.azuredatabricks.net/serving-endpoints",
    authHeader: "bearer",
  },
  deepinfra: {
    baseUrl: "https://api.deepinfra.com/v1/openai/chat/completions",
    authHeader: "bearer",
    thinkingFormat: "openai",
  },
  dgrid: {
    baseUrl: "https://api.dgrid.ai/v1/chat/completions",
    authHeader: "bearer",
    modelsUrl: "https://api.dgrid.ai/v1/models",
    defaultContextLength: 128000,
  },
  dify: { baseUrl: "https://api.dify.ai/v1/chat/completions", authHeader: "bearer" },
  dit: {
    baseUrl: "https://api.dit.ai/v1/chat/completions",
    authHeader: "bearer",
    modelsUrl: "https://api.dit.ai/v1/models",
    defaultContextLength: 200000,
  },
  doubao: { baseUrl: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", authHeader: "bearer" },
  factory: { baseUrl: "https://api.factory.ai/v1/chat/completions", authHeader: "bearer" },
  "featherless-ai": { baseUrl: "https://api.featherless.ai/v1/chat/completions", authHeader: "bearer" },
  freeaiapikey: {
    baseUrl: "https://freeaiapikey.com/v1/chat/completions",
    authHeader: "bearer",
    modelsUrl: "https://freeaiapikey.com/v1/models",
    defaultContextLength: 128000,
  },
  "freemodel-dev": {
    baseUrl: "https://api.freemodel.dev/v1/chat/completions",
    authHeader: "bearer",
    modelsUrl: "https://api.freemodel.dev/v1/models",
    defaultContextLength: 128000,
  },
  friendliai: {
    baseUrl: "https://api.friendli.ai/serverless/v1/chat/completions",
    authHeader: "bearer",
    modelsUrl: "https://api.friendli.ai/serverless/v1/models",
  },
  galadriel: { baseUrl: "https://api.galadriel.ai/v1/chat/completions", authHeader: "bearer" },
  gigachat: {
    baseUrl: "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
    tokenUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    tokenScope: "GIGACHAT_API_PERS",
    authHeader: "bearer",
  },
  gitlawb: { baseUrl: "https://opengateway.gitlawb.com/v1/xiaomi-mimo", authHeader: "bearer" },
  glhf: { baseUrl: "https://api.laf.run/v1/chat/completions", authHeader: "bearer" },
};

const expectedAliases = {
  crof: "crof",
  databricks: "databricks",
  deepinfra: "deepinfra",
  dgrid: "dgrid",
  dify: "dify",
  dit: "dai",
  doubao: "doubao",
  factory: "factory",
  "featherless-ai": "featherless",
  freeaiapikey: "faik",
  "freemodel-dev": "fmd",
  friendliai: "friendli",
  galadriel: "galadriel",
  gigachat: "gigachat",
  gitlawb: "glb",
  glhf: "glhf",
};

describe("OmniRoute simple/default provider batch B", () => {
  it("exports every owned provider through the generated registry index", () => {
    const registryById = new Map(REGISTRY.map((entry) => [entry.id, entry]));

    for (const id of ownedProviderIds) {
      const entry = registryById.get(id);
      expect(entry, `${id} should be exported from registry/index.js`).toBeTruthy();
      expect(entry.category).toBe("apikey");
      expect(entry.authType).toBe("apikey");
      expect(entry.alias).toBe(expectedAliases[id]);
      expect(entry.models.length, `${id} should keep a seed model list`).toBeGreaterThan(0);
    }
  });

  it("keeps endpoint-scoped providers hidden until connection forms collect endpoint data", () => {
    const registryById = new Map(REGISTRY.map((entry) => [entry.id, entry]));

    expect(registryById.get("databricks")?.hidden).toBe(true);
    expect(registryById.get("dify")?.hidden).toBe(true);
  });

  it("preserves OmniRoute OpenAI-compatible transport fields at runtime", () => {
    for (const id of ownedProviderIds) {
      expect(PROVIDERS[id], `${id} should be present in PROVIDERS`).toMatchObject({
        format: "openai",
        ...expectedTransports[id],
      });
    }

    expect(PROVIDERS.gitlawb.headers).toMatchObject({
      "User-Agent": "OpenClaude/1.0 (linux; x86_64)",
      "X-Title": "OpenClaude CLI",
      "HTTP-Referer": "https://github.com/Gitlawb/openclaude",
    });
  });

  it("keeps model aliases and passthrough fetchers for dynamic catalogs", () => {
    const registryById = new Map(REGISTRY.map((entry) => [entry.id, entry]));

    for (const [id, alias] of Object.entries(expectedAliases)) {
      expect(PROVIDER_MODELS[alias]?.length, `${id} should expose models under alias ${alias}`).toBeGreaterThan(0);
    }

    const dynamicProviders = ["crof", "deepinfra", "dgrid", "dit", "featherless-ai", "freeaiapikey", "freemodel-dev", "friendliai"];
    for (const id of dynamicProviders) {
      expect(PROVIDER_MEDIA[id], `${id} should expose media/dynamic model metadata`).toMatchObject({
        modelsFetcher: { type: "openai" },
      });
      expect(registryById.get(id)?.passthroughModels, `${id} should preserve passthrough models`).toBe(true);
    }
  });

  it("uses local copied icon files only when the asset exists", () => {
    const registryById = new Map(REGISTRY.map((entry) => [entry.id, entry]));
    const localIconProviders = {
      dify: "/providers/dify.svg",
      doubao: "/providers/doubao.svg",
      gigachat: "/providers/gigachat.png",
    };

    for (const [id, icon] of Object.entries(localIconProviders)) {
      expect(registryById.get(id)?.display?.icon).toBe(icon);
      expect(existsSync(resolve(repoRoot, "public", icon.slice(1))), `${icon} should exist`).toBe(true);
    }

    for (const id of ownedProviderIds.filter((providerId) => !(providerId in localIconProviders))) {
      expect(registryById.get(id)?.display?.icon).not.toMatch(/^\/providers\//);
    }
  });
});
