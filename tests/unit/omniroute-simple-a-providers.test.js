import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

const repoRoot = resolve(import.meta.dirname, "../..");

const ownedProviders = [
  "agentrouter",
  "ai21",
  "aimlapi",
  "alibaba",
  "api-airforce",
  "bai",
  "baichuan",
  "baidu",
  "bailian-coding-plan",
  "baseten",
  "bazaarlink",
  "bluesminds",
  "bytez",
  "codestral",
];

const expectedShape = {
  agentrouter: {
    alias: "agentrouter",
    format: "claude",
    baseUrl: "https://agentrouter.org/v1/messages",
    auth: { header: "x-api-key", scheme: "raw" },
    defaultContextLength: 128000,
    passthroughModels: true,
    model: "claude-opus-4-6",
  },
  ai21: {
    alias: "ai21",
    format: "openai",
    baseUrl: "https://api.ai21.com/studio/v1/chat/completions",
    model: "jamba-large-1.7",
  },
  aimlapi: {
    alias: "aiml",
    format: "openai",
    baseUrl: "https://api.aimlapi.com/v1/chat/completions",
    thinkingFormat: "openai",
    passthroughModels: true,
    model: "gpt-4o",
  },
  alibaba: {
    alias: "ali",
    format: "openai",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    modelsUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
    passthroughModels: true,
    model: "qwen-max",
  },
  "api-airforce": {
    alias: "af",
    format: "openai",
    baseUrl: "https://api.airforce/v1/chat/completions",
    validateUrl: "https://api.airforce/v1/models",
    defaultContextLength: 128000,
    thinkingFormat: "openai",
    model: "x-ai/grok-3",
  },
  bai: {
    alias: "bai",
    format: "openai",
    baseUrl: "https://api.b.ai/v1/chat/completions",
    modelsUrl: "https://api.b.ai/v1/models",
    thinkingFormat: "openai",
    passthroughModels: true,
    modelCount: 0,
  },
  baichuan: {
    alias: "baichuan",
    format: "openai",
    baseUrl: "https://api.baichuan-ai.com/v1/chat/completions",
    model: "Baichuan4-Turbo",
  },
  baidu: {
    alias: "baidu",
    format: "openai",
    baseUrl: "https://qianfan.baidubce.com/v2/chat/completions",
    model: "ernie-5.1",
  },
  "bailian-coding-plan": {
    alias: "bcp",
    format: "claude",
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1/messages",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
    model: "qwen3.7-plus",
  },
  baseten: {
    alias: "baseten",
    format: "openai",
    baseUrl: "https://inference.baseten.co/v1/chat/completions",
    thinkingFormat: "openai",
    model: "moonshotai/Kimi-K2.6",
  },
  bazaarlink: {
    alias: "bzl",
    format: "openai",
    baseUrl: "https://bazaarlink.ai/api/v1/chat/completions",
    modelsUrl: "https://bazaarlink.ai/api/v1/models",
    thinkingFormat: "openai",
    model: "auto:free",
  },
  bluesminds: {
    alias: "bm",
    format: "openai",
    baseUrl: "https://api.bluesminds.com/v1/chat/completions",
    modelsUrl: "https://api.bluesminds.com/v1/models",
    defaultContextLength: 128000,
    thinkingFormat: "openai",
    model: "gpt-4o",
  },
  bytez: {
    alias: "bytez",
    format: "openai",
    baseUrl: "https://api.bytez.com/models/v2/openai/v1/chat/completions",
    model: "meta-llama/Llama-3.3-70B-Instruct",
  },
  codestral: {
    alias: "codestral",
    format: "openai",
    baseUrl: "https://codestral.mistral.ai/v1/chat/completions",
    model: "codestral-2508",
  },
};

describe("OmniRoute simple/default provider batch A", () => {
  it("registers each owned provider with DurinDoor's default registry contract", () => {
    for (const id of ownedProviders) {
      const entry = REGISTRY.find((provider) => provider.id === id);
      const shape = expectedShape[id];

      expect(entry, `${id} registry entry`).toBeDefined();
      expect(entry.category, `${id} category`).toBe("apikey");
      expect(entry.alias, `${id} alias`).toBe(shape.alias);
      expect(entry.display?.name, `${id} display name`).toEqual(expect.any(String));
      expect(entry.transport?.baseUrl, `${id} baseUrl`).toBe(shape.baseUrl);
      expect(PROVIDERS[id]?.format, `${id} runtime format`).toBe(shape.format);
      expect(PROVIDERS[id]?.baseUrl, `${id} runtime baseUrl`).toBe(shape.baseUrl);

      if (shape.modelsUrl) {
        expect(entry.transport.modelsUrl, `${id} modelsUrl`).toBe(shape.modelsUrl);
      }
      if (shape.validateUrl) {
        expect(entry.transport.validateUrl, `${id} validateUrl`).toBe(shape.validateUrl);
        expect(PROVIDERS[id].validateUrl, `${id} runtime validateUrl`).toBe(shape.validateUrl);
      }
      if (shape.chatPath) {
        expect(entry.transport.chatPath, `${id} chatPath`).toBe(shape.chatPath);
      }
      if (shape.thinkingFormat) {
        expect(entry.transport.thinkingFormat, `${id} thinkingFormat`).toBe(shape.thinkingFormat);
        expect(PROVIDERS[id].thinkingFormat, `${id} runtime thinkingFormat`).toBe(shape.thinkingFormat);
      }
      if (shape.defaultContextLength) {
        expect(entry.transport.defaultContextLength, `${id} defaultContextLength`).toBe(shape.defaultContextLength);
        expect(PROVIDERS[id].defaultContextLength, `${id} runtime defaultContextLength`).toBe(shape.defaultContextLength);
      }
      if (shape.auth) {
        expect(entry.transport.auth, `${id} auth`).toMatchObject(shape.auth);
      }
      if (shape.passthroughModels) {
        expect(entry.passthroughModels, `${id} passthroughModels`).toBe(true);
      }

      const models = PROVIDER_MODELS[shape.alias] || [];
      if (shape.modelCount !== undefined) {
        expect(models.length, `${id} model count`).toBe(shape.modelCount);
      } else {
        expect(models.map((model) => model.id), `${id} models`).toContain(shape.model);
      }
    }
  });

  it("uses local copied icons where the OmniRoute source provided provider assets", () => {
    const expectedIconAssets = {
      agentrouter: "agentrouter.png",
      aimlapi: "aimlapi.png",
      baichuan: "baichuan.svg",
      baidu: "baidu.svg",
      bazaarlink: "bazaarlink.svg",
    };

    for (const [id, icon] of Object.entries(expectedIconAssets)) {
      const entry = REGISTRY.find((provider) => provider.id === id);
      expect(entry.display.icon, `${id} display icon`).toBe(id);
      expect(
        existsSync(resolve(repoRoot, "public/providers", icon)),
        `${icon} should exist for ${id}`,
      ).toBe(true);
    }
  });

  it("does not introduce duplicate registry ids", () => {
    const ids = REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
