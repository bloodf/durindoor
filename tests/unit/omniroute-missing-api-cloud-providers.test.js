import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { AzureOpenAIExecutor } from "../../open-sse/executors/azure-openai.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { getTargetFormat } from "../../open-sse/services/provider.js";
import { APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";

const repoRoot = resolve(import.meta.dirname, "../..");
const providerById = Object.fromEntries(REGISTRY.map((provider) => [provider.id, provider]));

const sourceBackedProviders = [
  "alibaba-cn",
  "github-models",
  "gitlawb-gmi",
  "glmt",
  "kimi-coding-apikey",
  "360ai",
  "arcee-ai",
  "azure-ai",
  "azure-openai",
  "cablyai",
  "clarifai",
  "cliproxyapi",
  "datarobot",
  "empower",
  "fenayai",
  "getgoapi",
  "laozhang",
  "nomic",
  "oci",
  "piapi",
  "poe",
  "sap",
  "thebai",
  "watsonx",
];

const localIconExtensions = {
  "360ai": "svg",
  "arcee-ai": "svg",
  clarifai: "svg",
  cliproxyapi: "png",
  empower: "png",
  "gitlawb-gmi": "svg",
  nomic: "svg",
  oci: "svg",
  piapi: "png",
  sap: "svg",
};

describe("OmniRoute missing API-key cloud provider ports", () => {
  it("registers source-backed Batch F providers and available local icons", () => {
    for (const id of sourceBackedProviders) {
      expect(providerById[id], `${id} should be in registry`).toBeDefined();
      const extension = localIconExtensions[id];
      if (extension) {
        expect(existsSync(resolve(repoRoot, "public/providers", `${id}.${extension}`)), `${id}.${extension} should exist`).toBe(true);
      }
    }
  });

  it("preserves endpoint, auth, and model shape from OmniRoute", () => {
    expect(PROVIDERS["alibaba-cn"]).toMatchObject({
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      validateUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
      auth: { header: "Authorization", scheme: "bearer" },
    });
    expect(providerById["alibaba-cn"].passthroughModels).toBe(true);
    expect(providerById["alibaba-cn"].models.map((model) => model.id)).toContain("qwen3-coder-plus");

    expect(PROVIDERS["github-models"]).toMatchObject({
      baseUrl: "https://models.github.ai/inference/chat/completions",
      validateUrl: "https://models.github.ai/inference/models",
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
        Accept: "application/vnd.github+json",
      },
    });
    expect(providerById["github-models"].serviceKinds).toEqual(["llm"]);
    expect(providerById["github-models"].models.some((model) => model.kind === "embedding")).toBe(false);

    expect(PROVIDERS["gitlawb-gmi"]).toMatchObject({
      baseUrl: "https://opengateway.gitlawb.com/v1/gmi-cloud/chat/completions",
      modelsUrl: "https://opengateway.gitlawb.com/v1/gmi-cloud/models",
      headers: {
        "User-Agent": "OpenClaude/1.0 (linux; x86_64)",
        "X-Title": "OpenClaude CLI",
        "HTTP-Referer": "https://github.com/Gitlawb/openclaude",
      },
    });
    expect(providerById["gitlawb-gmi"].passthroughModels).toBe(true);

    expect(PROVIDERS.glmt).toMatchObject({
      baseUrl: "https://api.z.ai/api/coding/paas/v4/chat/completions",
      timeoutMs: 900000,
      requestDefaults: {
        maxTokens: 65536,
        temperature: 0.2,
        thinkingBudgetTokens: 24576,
        thinkingType: "adaptive",
      },
    });
    expect(providerById.glmt.defaultContextLength).toBe(1000000);
    expect(providerById.glmt.models.find((model) => model.id === "glm-5.2")).toMatchObject({
      contextLength: 1000000,
      maxOutputTokens: 131072,
      supportsReasoning: true,
      toolCalling: true,
    });
    expect(providerById.glmt.models.find((model) => model.id === "glm-4.6v")).toMatchObject({
      contextLength: 128000,
      supportsVision: true,
    });

    expect(PROVIDERS["kimi-coding-apikey"]).toMatchObject({
      baseUrl: "https://api.kimi.com/coding/v1/messages",
      format: "claude",
      auth: { header: "x-api-key", scheme: "raw" },
    });
    expect(PROVIDERS["kimi-coding-apikey"].urlSuffix).toBeUndefined();
    expect(PROVIDERS["kimi-coding-apikey"].transports.map((transport) => transport.format)).toEqual(["openai", "claude"]);
  });

  it("ports non-registry OmniRoute provider runtime minimums", () => {
    expect(PROVIDERS["azure-ai"]).toMatchObject({
      baseUrl: "https://example-resource.services.ai.azure.com/openai/v1/chat/completions",
      validateUrl: "https://example-resource.services.ai.azure.com/openai/v1/models",
      auth: { header: "api-key", scheme: "raw" },
    });
    expect(PROVIDERS["azure-openai"].executor).toBe("azure-openai");
    expect(new AzureOpenAIExecutor().buildUrl("client-model", false, 0, {
      providerSpecificData: {
        baseUrl: "https://resource.openai.azure.com/",
        deployment: "dashboard-deployment",
        apiVersion: "2025-01-01-preview",
      },
    })).toBe("https://resource.openai.azure.com/openai/deployments/dashboard-deployment/chat/completions?api-version=2025-01-01-preview");
    expect(PROVIDERS.clarifai.auth).toMatchObject({
      header: "Authorization",
      scheme: "key",
    });
    expect(PROVIDERS.datarobot).toMatchObject({
      baseUrl: "https://app.datarobot.com/api/v2/genai/llmgw/chat/completions/",
      validateUrl: "https://app.datarobot.com/api/v2/genai/llmgw/catalog/",
    });
    expect(PROVIDERS.oci.baseUrl).toBe("https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/openai/v1/chat/completions");
    expect(PROVIDERS.sap.baseUrl).toContain("/v2/lm/deployments/example-deployment/chat/completions");
    expect(providerById.sap.hasProviderSpecificData).toBe(true);
    expect(PROVIDERS.watsonx.baseUrl).toBe("https://ca-tor.ml.cloud.ibm.com/ml/gateway/v1/chat/completions");
    expect(PROVIDERS.cliproxyapi.baseUrl).toBe("http://127.0.0.1:8317/v1/chat/completions");
    expect(providerById.nomic.serviceKinds).toEqual([]);
    expect(providerById.nomic.models).toEqual([]);
    expect(providerById.nomic.embeddingConfig).toBeUndefined();
  });

  it("keeps existing Azure aliases and provider exports stable", () => {
    expect(resolveProviderAlias("azure")).toBe("azure");
    expect(resolveProviderAlias("azure-openai")).toBe("azure-openai");
    expect(providerById["azure-openai"].alias).toBe("azure-openai");
    expect(providerById.nube).toBeDefined();
    expect(providerById.kenari).toBeDefined();
  });

  it("aligns target body format with Responses routing for Azure AI and OCI", () => {
    const credentials = { providerSpecificData: { apiType: "responses" } };

    expect(getTargetFormat("azure-ai", credentials)).toBe("openai-responses");
    expect(getTargetFormat("oci", credentials)).toBe("openai-responses");
    expect(getTargetFormat("azure-ai", { providerSpecificData: { apiType: "chat" } })).toBe("openai");
  });

  it("hides Nomic from the API-key category until an embeddings adapter exists", () => {
    expect(providerById.nomic.category).toBe("hidden");
    expect(APIKEY_PROVIDERS.nomic).toBeUndefined();
    expect(providerById.nomic.serviceKinds).toEqual([]);
  });

  it("builds stable URL and auth header snapshots through DefaultExecutor", () => {
    const github = new DefaultExecutor("github-models");
    const githubHeaders = github.buildHeaders({ apiKey: "ghp_test" }, false);

    expect({
      url: github.buildUrl("openai/gpt-4o", false),
      authorization: githubHeaders.Authorization,
      accept: githubHeaders.Accept,
      apiVersion: githubHeaders["X-GitHub-Api-Version"],
    }).toMatchInlineSnapshot(`
      {
        "accept": "application/vnd.github+json",
        "apiVersion": "2022-11-28",
        "authorization": "Bearer ghp_test",
        "url": "https://models.github.ai/inference/chat/completions",
      }
    `);

    const kimi = new DefaultExecutor("kimi-coding-apikey");
    const kimiHeaders = kimi.buildHeaders({ apiKey: "kimi-test" }, false);

    expect({
      url: kimi.buildUrl("kimi-for-coding", false),
      anthropicVersion: kimiHeaders["Anthropic-Version"],
      authorization: kimiHeaders.Authorization,
      xApiKey: kimiHeaders["x-api-key"],
    }).toMatchInlineSnapshot(`
      {
        "anthropicVersion": "2023-06-01",
        "authorization": undefined,
        "url": "https://api.kimi.com/coding/v1/messages",
        "xApiKey": "kimi-test",
      }
    `);

    const clarifai = new DefaultExecutor("clarifai");
    const clarifaiHeaders = clarifai.buildHeaders({ apiKey: "clarifai-test" }, false);

    expect({
      url: clarifai.buildUrl("clarifai/model", false),
      authorization: clarifaiHeaders.Authorization,
    }).toEqual({
      url: "https://api.clarifai.com/v2/ext/openai/v1/chat/completions",
      authorization: "Key clarifai-test",
    });

    const glmt = new DefaultExecutor("glmt");
    expect(glmt.transformRequest("glm-5.2", { messages: [] }, false, {})).toMatchObject({
      max_tokens: 65536,
      temperature: 0.2,
      thinking: {
        budget_tokens: 24576,
        type: "adaptive",
      },
    });

    for (const [alias, effort] of [
      ["glm-5.2-high", "high"],
      ["glm-5.2-max", "max"],
    ]) {
      expect(glmt.transformRequest(alias, { model: alias, messages: [] }, false, {})).toMatchObject({
        model: "glm-5.2",
        max_tokens: 65536,
        temperature: 0.2,
        reasoning_effort: effort,
        thinking: {
          budget_tokens: 24576,
          type: "adaptive",
        },
      });
    }
  });
});
