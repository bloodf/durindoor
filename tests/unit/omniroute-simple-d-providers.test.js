import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MODELS, PROVIDERS } from "../../open-sse/providers/index.js";

const repoRoot = resolve(import.meta.dirname, "../..");

const ownedProviders = [
  "modal",
  "modelscope",
  "monsterapi",
  "moonshot",
  "morph",
  "nanogpt",
  "nlpcloud",
  "nous-research",
  "novita",
  "nscale",
  "ollama-cloud",
  "openadapter",
  "orcarouter",
  "ovhcloud",
  "pioneer",
  "predibase",
  "publicai",
];

const expected = {
  modal: { alias: "modal", baseUrl: "https://api.modal.ai/v1/chat/completions", firstModel: "google/gemini-2.0-flash" },
  modelscope: { alias: "ms", baseUrl: "https://api-inference.modelscope.cn/v1/chat/completions", validateUrl: "https://api-inference.modelscope.cn/v1/models", passthroughModels: true },
  monsterapi: { alias: "monster", baseUrl: "https://api.monsterapi.ai/v1/chat/completions", firstModel: "meta-llama/Meta-Llama-3.1-8B-Instruct" },
  moonshot: { alias: "moonshot", baseUrl: "https://api.moonshot.ai/v1/chat/completions", firstModel: "kimi-k2.6" },
  morph: { alias: "morph", baseUrl: "https://api.morphllm.com/v1/chat/completions", firstModel: "morph-v3-large" },
  nanogpt: { alias: "nanogpt", baseUrl: "https://nano-gpt.com/api/v1/chat/completions", firstModel: "chatgpt-4o-latest" },
  nlpcloud: { alias: "nlpc", baseUrl: "https://api.nlpcloud.io/v1/chat/completions", firstModel: "chatdolphin" },
  "nous-research": { alias: "nous", baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions", firstModel: "Hermes-4-405B" },
  novita: { alias: "novita", baseUrl: "https://api.novita.ai/openai/v1/chat/completions", validateUrl: "https://api.novita.ai/openai/v1/models", firstModel: "meta-llama/llama-3.1-8b-instruct" },
  nscale: { alias: "nscale", baseUrl: "https://inference.api.nscale.com/v1/chat/completions", firstModel: "moonshotai/Kimi-K2.5" },
  "ollama-cloud": { alias: "ollamacloud", baseUrl: "https://ollama.com/v1/chat/completions", validateUrl: "https://ollama.com/api/tags", passthroughModels: true, firstModel: "deepseek-v4-pro" },
  openadapter: { alias: "oad", baseUrl: "https://api.openadapter.in/v1/chat/completions", validateUrl: "https://api.openadapter.in/v1/models", firstModel: "glm-4.7", defaultContextLength: 128000 },
  orcarouter: { alias: "orcarouter", baseUrl: "https://api.orcarouter.ai/v1", firstModel: "orcarouter/auto", defaultContextLength: 128000 },
  ovhcloud: { alias: "ovh", baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions", firstModel: "Meta-Llama-3_3-70B-Instruct" },
  pioneer: { alias: "pn", baseUrl: "https://api.pioneer.ai/v1/chat/completions", firstModel: "Qwen/Qwen3-32B", auth: { combined: true, header: "x-api-key", scheme: "raw" } },
  predibase: { alias: "predibase", baseUrl: "https://serving.app.predibase.com/v1/chat/completions", firstModel: "llama-3.3-70b" },
  publicai: { alias: "publicai", baseUrl: "https://api.publicai.co/v1/chat/completions", firstModel: "swiss-ai/apertus-70b-instruct" },
};

describe("OmniRoute simple/default Batch D providers", () => {
  it("registers every owned provider with preserved transport fields and seed models", () => {
    const byId = Object.fromEntries(REGISTRY.map((entry) => [entry.id, entry]));

    for (const id of ownedProviders) {
      const entry = byId[id];
      const spec = expected[id];
      expect(entry, `${id} registry entry`).toBeTruthy();
      expect(entry.category).toBe("apikey");
      expect(entry.authType).toBe("apikey");
      expect(PROVIDERS[id]?.format, `${id} format`).toBe("openai");
      expect(PROVIDERS[id]?.baseUrl, `${id} baseUrl`).toBe(spec.baseUrl);
      expect(PROVIDERS[id]?.validateUrl, `${id} validateUrl`).toBe(spec.validateUrl);
      expect(PROVIDERS[id]?.auth, `${id} auth descriptor`).toEqual(spec.auth);
      expect(entry.defaultContextLength, `${id} default context`).toBe(spec.defaultContextLength);
      expect(entry.passthroughModels, `${id} passthrough`).toBe(spec.passthroughModels);

      const models = PROVIDER_MODELS[spec.alias];
      expect(models, `${id} models under alias ${spec.alias}`).toBeTruthy();
      if (spec.firstModel) expect(models[0]?.id).toBe(spec.firstModel);
    }

    expect(PROVIDERS.orcarouter.headers).toMatchObject({
      "HTTP-Referer": "https://endpoint-proxy.local",
      "X-Title": "Endpoint Proxy",
    });
  });

  it("keeps Batch D copied source icons local when OmniRoute has an icon", () => {
    const expectedIcons = [
      "modal.svg",
      "monsterapi.svg",
      "nanogpt.png",
      "nlpcloud.svg",
      "nscale.png",
      "ovhcloud.png",
      "predibase.png",
    ];

    for (const icon of expectedIcons) {
      expect(
        existsSync(resolve(repoRoot, "public/providers", icon)),
        `${icon} should be served from public/providers`,
      ).toBe(true);
    }
  });
});
