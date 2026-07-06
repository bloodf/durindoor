import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const repoRoot = resolve(import.meta.dirname, "../..");

const ownedProviderIds = [
  "hackclub",
  "haiper",
  "heroku",
  "ideogram",
  "iflytek",
  "inclusionai",
  "inference-net",
  "kie",
  "kilo-gateway",
  "kluster",
  "lambda-ai",
  "leonardo",
  "liquid",
  "llamagate",
  "llm7",
  "longcat",
  "maritalk",
  "meta-llama",
];

const preExistingTailProviderIds = ["nube", "kenari"];

const expectedShape = {
  hackclub: {
    alias: "hc",
    authType: "optional",
    baseUrl: "https://ai.hackclub.com/proxy/v1/chat/completions",
    authHeader: "bearer",
    modelsFetcher: "https://ai.hackclub.com/proxy/v1/models",
    passthroughModels: true,
    defaultContextLength: 128000,
    modelIds: ["meta-llama/llama-3.3-70b-instruct"],
  },
  haiper: {
    alias: "hp",
    authType: "apikey",
    baseUrl: "https://api.haiper.ai/v1",
    authHeader: "HAIPER_KEY",
    runtimeAuth: { header: "HAIPER_KEY", scheme: "raw" },
    serviceKinds: ["image", "video"],
    modelIds: ["gen2", "gen2-image"],
  },
  heroku: {
    alias: "heroku",
    authType: "apikey",
    baseUrl: "https://us.inference.heroku.com/v1/chat/completions",
    authHeader: "bearer",
    modelIds: ["claude-opus-4-7", "nova-2-lite"],
  },
  ideogram: {
    alias: "ideo",
    authType: "apikey",
    imageBaseUrl: "https://api.ideogram.ai",
    imageAuthHeader: "Api-Key",
    serviceKinds: ["image"],
    modelIds: ["V_3", "V_2A"],
  },
  iflytek: {
    alias: "iflytek",
    authType: "apikey",
    baseUrl: "https://spark-api.xf-yun.com/v1/chat/completions",
    authHeader: "bearer",
    modelIds: ["4.0Ultra", "pro-128k"],
  },
  inclusionai: {
    alias: "inclusionai",
    authType: "apikey",
    baseUrl: "https://api.inclusionai.tech/v1/chat/completions",
    authHeader: "bearer",
    modelIds: ["inclusion-model"],
  },
  "inference-net": {
    alias: "inet",
    authType: "apikey",
    baseUrl: "https://api.inference.net/v1/chat/completions",
    authHeader: "bearer",
    modelIds: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct"],
  },
  kie: {
    alias: "kie",
    authType: "apikey",
    baseUrl: "https://api.kie.ai/v1/chat/completions",
    authHeader: "bearer",
    defaultContextLength: 128000,
    modelIds: ["claude-opus-4-8", "gemini-3-5-flash"],
  },
  "kilo-gateway": {
    alias: "kg",
    authType: "apikey",
    baseUrl: "https://api.kilo.ai/api/gateway/chat/completions",
    authHeader: "bearer",
    modelsFetcher: "https://api.kilo.ai/api/gateway/models",
    passthroughModels: true,
    modelIds: ["kilo-auto/frontier", "arcee-ai/trinity-large-preview:free"],
  },
  kluster: {
    alias: "kluster",
    authType: "apikey",
    baseUrl: "https://api.kluster.ai/v1/chat/completions",
    authHeader: "bearer",
    modelIds: ["auto"],
  },
  "lambda-ai": {
    alias: "lambda",
    authType: "apikey",
    baseUrl: "https://api.lambda.ai/v1/chat/completions",
    authHeader: "bearer",
    modelIds: ["deepseek-r1-671b", "qwen25-coder-32b-instruct"],
  },
  leonardo: {
    alias: "leo",
    authType: "apikey",
    imageBaseUrl: "https://cloud.leonardo.ai/api/rest/v1",
    imageAuthHeader: "bearer",
    serviceKinds: ["image"],
    modelIds: ["phoenix", "sdxl"],
  },
  liquid: {
    alias: "liquid",
    authType: "apikey",
    baseUrl: "https://api.liquid.ai/v1/chat/completions",
    authHeader: "bearer",
    modelIds: ["liquid-lfm-40b"],
  },
  llamagate: {
    alias: "llamagate",
    authType: "apikey",
    baseUrl: "https://llamagate.ai/v1/chat/completions",
    authHeader: "bearer",
    modelIds: ["qwen2.5-coder-7b", "qwen3-vl-8b"],
  },
  llm7: {
    alias: "llm7",
    authType: "apikey",
    baseUrl: "https://api.llm7.io/v1/chat/completions",
    authHeader: "bearer",
    modelsFetcher: "https://api.llm7.io/v1/models",
    modelIds: ["gpt-4o-mini-2024-07-18", "qwen2.5-coder-32b-instruct"],
  },
  longcat: {
    alias: "lc",
    authType: "apikey",
    baseUrl: "https://api.longcat.chat/openai/v1/chat/completions",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    runtimeAuth: { header: "Authorization", scheme: "bearer" },
    modelIds: ["LongCat-2.0"],
  },
  maritalk: {
    alias: "maritalk",
    authType: "apikey",
    baseUrl: "https://chat.maritaca.ai/api",
    authHeader: "key",
    runtimeAuth: { header: "key", scheme: "raw" },
    modelIds: ["sabia-4", "sabiazinho-3"],
  },
  "meta-llama": {
    alias: "meta",
    authType: "apikey",
    baseUrl: "https://api.llama.com/compat/v1/chat/completions",
    authHeader: "bearer",
    modelIds: ["Llama-4-Maverick-17B-128E-Instruct-FP8", "Llama-3.3-8B-Instruct"],
  },
};

describe("OmniRoute simple/default provider batch C", () => {
  it("exports every statically imported registry entry", () => {
    const indexSource = readFileSync(
      resolve(repoRoot, "open-sse/providers/registry/index.js"),
      "utf8",
    );
    const importedVars = [...indexSource.matchAll(/^import\s+(p\d+)\s+from\s+".+\.js";$/gm)].map(
      ([, variable]) => variable,
    );
    const exportedVars = [...indexSource.matchAll(/^\s+(p\d+),$/gm)].map(([, variable]) => variable);

    expect(exportedVars).toEqual(importedVars);
  });

  it("keeps pre-existing tail providers registered when Batch C providers are added", () => {
    const ids = REGISTRY.map((provider) => provider.id);

    for (const id of preExistingTailProviderIds) {
      expect(ids.filter((item) => item === id), `${id} registry entries`).toHaveLength(1);
    }
  });

  it("registers each owned provider exactly once", () => {
    const ids = REGISTRY.map((provider) => provider.id);

    for (const id of ownedProviderIds) {
      expect(ids.filter((item) => item === id), `${id} registry entries`).toHaveLength(1);
    }
  });

  it("preserves provider auth, endpoint, passthrough, context, and model fields", () => {
    const registryById = new Map(REGISTRY.map((provider) => [provider.id, provider]));

    for (const [id, expected] of Object.entries(expectedShape)) {
      const provider = registryById.get(id);
      expect(provider, `${id} provider`).toBeDefined();
      expect(provider.alias, `${id} alias`).toBe(expected.alias);
      expect(provider.authType, `${id} auth type`).toBe(expected.authType);

      if (expected.baseUrl) {
        expect(provider.transport?.baseUrl, `${id} base URL`).toBe(expected.baseUrl);
      }
      if (expected.authHeader) {
        expect(provider.transport?.authHeader, `${id} auth header`).toBe(expected.authHeader);
      }
      if (expected.authPrefix) {
        expect(provider.transport?.authPrefix, `${id} auth prefix`).toBe(expected.authPrefix);
      }
      if (expected.runtimeAuth) {
        expect(provider.transport?.auth, `${id} runtime auth`).toMatchObject(expected.runtimeAuth);
      }
      if (expected.imageBaseUrl) {
        expect(provider.imageConfig?.baseUrl, `${id} image base URL`).toBe(expected.imageBaseUrl);
      }
      if (expected.imageAuthHeader) {
        expect(provider.imageConfig?.authHeader, `${id} image auth header`).toBe(expected.imageAuthHeader);
      }
      if (expected.modelsFetcher) {
        expect(provider.modelsFetcher?.url, `${id} models fetcher`).toBe(expected.modelsFetcher);
      }
      if ("passthroughModels" in expected) {
        expect(provider.passthroughModels, `${id} passthrough`).toBe(expected.passthroughModels);
      }
      if (expected.defaultContextLength) {
        expect(provider.defaultContextLength, `${id} default context`).toBe(expected.defaultContextLength);
      }
      if (expected.serviceKinds) {
        expect(provider.serviceKinds, `${id} service kinds`).toEqual(expected.serviceKinds);
      }

      const modelIds = provider.models.map((model) => model.id);
      for (const modelId of expected.modelIds || []) {
        expect(modelIds, `${id} model ${modelId}`).toContain(modelId);
      }
    }
  });

  it("keeps available copied icons for owned providers local", () => {
    const copiedIcons = [
      "heroku.png",
      "iflytek.svg",
      "inclusionai.svg",
      "kie.png",
      "kilo-gateway.svg",
      "liquid.svg",
      "llamagate.png",
      "maritalk.png",
    ];

    for (const icon of copiedIcons) {
      expect(
        existsSync(resolve(repoRoot, "public/providers", icon)),
        `${icon} should be served from public/providers`,
      ).toBe(true);
    }
  });
});
