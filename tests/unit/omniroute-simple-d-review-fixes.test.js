// Fixes from the PR #46 (OmniRoute simple batch D) review thread:
// - orcarouter/ollama-cloud/morph: multi-family OpenAI-compatible providers must
//   force thinkingFormat:"openai" so per-model native thinking patterns (deepseek/
//   minimax/qwen/kimi) don't leak through and produce the wrong wire shape.
// - capabilities.js "nscale": moonshotai/Kimi-K2.5's case differs from the
//   canonical "kimi-k2.5" exact-id key, so it fell through to the generic
//   "*kimi*" pattern (thinkingFormat:"kimi") instead of "openai".
// - openadapter: documents why its GLM-4.7 contextLength (128000) intentionally
//   undercuts the canonical capabilities.js window (200000).
// - modelscope/suggested-models filters.js: modelsFetcher.type:"openai" had no
//   matching entry in FILTERS, so every provider using it (modelscope,
//   openadapter, kenari, novita, venice, vercel-ai-gateway) got a 400 "Unknown
//   filter type" and silently showed zero suggested models.
// - ollama-cloud validateUrl: the generic default validate branch derived its
//   probe URL from baseUrl via regex, ignoring registry validateUrl entirely.
// - modelscope suggested-models: proxy the user's configured API key server-side
//   so the provider's authenticated /v1/models endpoint can be queried.
// - orcarouter: expose registry-declared per-model context windows and max output
//   through capabilities so /v1/models and combo routing use the correct limits.
// - nous-research: Hermes 4 models support reasoning with a 128K context window.
// - ovhcloud: the Mistral Small 3.2 vision flag must flow through capability
//   resolution so image requests are not stripped before translation.
import { describe, expect, it, vi } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getProviderConnections } from "@/models";
import openadapter from "../../open-sse/providers/registry/openadapter.js";
import modelscope from "../../open-sse/providers/registry/modelscope.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import ollamaCloudRegistry from "../../open-sse/providers/registry/ollama-cloud.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

vi.mock("@/models", async () => {
  const actual = await vi.importActual("@/models");
  return { ...actual, getProviderConnections: vi.fn() };
});

describe("PR #46 review: thinkingFormat overrides", () => {
  it("orcarouter forces openai thinkingFormat on the runtime PROVIDERS map", () => {
    expect(PROVIDERS.orcarouter?.thinkingFormat).toBe("openai");
  });

  it("ollama-cloud forces openai thinkingFormat on the runtime PROVIDERS map", () => {
    expect(PROVIDERS["ollama-cloud"]?.thinkingFormat).toBe("openai");
  });

  it("morph forces openai thinkingFormat on the runtime PROVIDERS map", () => {
    expect(PROVIDERS.morph?.thinkingFormat).toBe("openai");
  });

  it("modelscope forces openai thinkingFormat on the runtime PROVIDERS map", () => {
    expect(PROVIDERS.modelscope?.thinkingFormat).toBe("openai");
  });
});

describe("PR #46 review: modelscope thinking wire shape", () => {
  it("applies OpenAI reasoning_effort shape for a Qwen model on ModelScope", () => {
    const body = { reasoning_effort: "high" };
    applyThinking("openai", "Qwen/Qwen3-32B", body, "modelscope");
    expect(body.reasoning_effort).toBe("high");
    expect(body.enable_thinking).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it("applies OpenAI reasoning_effort shape for a GLM model on ModelScope", () => {
    const body = { reasoning_effort: "medium" };
    applyThinking("openai", "glm-4.7", body, "modelscope");
    expect(body.reasoning_effort).toBe("medium");
    expect(body.thinking).toBeUndefined();
    expect(body.enable_thinking).toBeUndefined();
  });
});

describe("PR #46 review: ollama-cloud validateUrl", () => {
  it("registers the dedicated api/tags key-check endpoint", () => {
    expect(PROVIDERS["ollama-cloud"]?.validateUrl).toBe("https://ollama.com/api/tags");
  });

  it("POST /api/providers/validate probes registry validateUrl, not a derived /models guess", async () => {
    const originalFetch = global.fetch;
    const calledUrls = [];
    global.fetch = vi.fn((url) => {
      calledUrls.push(url);
      return Promise.resolve({ ok: true, status: 200 });
    });
    try {
      const { POST } = await import("../../src/app/api/providers/validate/route.js");
      const req = new Request("http://localhost/api/providers/validate", {
        method: "POST",
        body: JSON.stringify({ provider: "ollama-cloud", apiKey: "sk-test" }),
      });
      const res = await POST(req);
      const json = await res.json();

      expect(calledUrls).toEqual(["https://ollama.com/api/tags"]);
      expect(json.valid).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("PR #46 review: nscale Kimi override", () => {
  it("resolves openai for moonshotai/Kimi-K2.5 (case-sensitive key)", () => {
    const caps = getCapabilitiesForModel("nscale", "moonshotai/Kimi-K2.5");
    expect(caps.thinkingFormat).toBe("openai");
    expect(caps.reasoning).toBe(true);
  });

  it("still resolves openai for the existing Qwen override", () => {
    const caps = getCapabilitiesForModel("nscale", "Qwen/Qwen3-235B-A22B-Instruct-2507");
    expect(caps.thinkingFormat).toBe("openai");
  });
});

describe("PR #46 review: openadapter context limit", () => {
  it("caps GLM-4.7 at OpenAdapter's documented 128000, below canonical 200000", () => {
    expect(openadapter.defaultContextLength).toBe(128000);
    const modelEntry = openadapter.models.find((m) => m.id === "glm-4.7");
    expect(modelEntry.contextLength).toBe(128000);
    const canonical = getCapabilitiesForModel(null, "glm-4.7");
    expect(canonical.contextWindow).toBe(200000);
  });
});

describe("PR #46 review: ovhcloud Mistral Small vision flag", () => {
  it("marks Mistral-Small-3.2-24B-Instruct-2506 as vision-capable in registry", async () => {
    const { default: ovhcloud } = await import("../../open-sse/providers/registry/ovhcloud.js");
    const model = ovhcloud.models.find((m) => m.id === "Mistral-Small-3.2-24B-Instruct-2506");
    expect(model?.supportsVision).toBe(true);
  });

  it("exposes OVH Mistral vision through getCapabilitiesForModel", () => {
    const caps = getCapabilitiesForModel("ovhcloud", "Mistral-Small-3.2-24B-Instruct-2506");
    expect(caps.vision).toBe(true);
  });

  it("overrides OVH Qwen2.5 Coder so it is not advertised as Qwen-native reasoning", () => {
    const caps = getCapabilitiesForModel("ovhcloud", "Qwen2.5-Coder-32B-Instruct");
    expect(caps.reasoning).toBe(false);
    expect(caps.thinkingFormat).not.toBe("qwen");
  });
});

describe("PR #46 review: orcarouter context limits", () => {
  it("exposes the registry 1M+ context for the GPT-5.5 entry", () => {
    expect(getCapabilitiesForModel("orcarouter", "openai/gpt-5.5")).toMatchObject({
      contextWindow: 1050000,
      maxOutput: 128000,
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
    });
  });

  it("exposes the registry 1M context for the Gemini 3.5 Flash entry", () => {
    expect(getCapabilitiesForModel("orcarouter", "google/gemini-3.5-flash")).toMatchObject({
      contextWindow: 1048576,
      maxOutput: 65536,
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
    });
  });

  it("exposes the registry 1M context for the Claude Opus 4.8 entry", () => {
    expect(getCapabilitiesForModel("orcarouter", "anthropic/claude-opus-4.8")).toMatchObject({
      contextWindow: 1000000,
      maxOutput: 128000,
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
    });
  });

  it("exposes the registry 1M context for the Grok 4.3 entry", () => {
    expect(getCapabilitiesForModel("orcarouter", "grok/grok-4.3")).toMatchObject({
      contextWindow: 1000000,
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
    });
  });

  it("exposes the registry 1M context for the DeepSeek V4 Pro entry", () => {
    expect(getCapabilitiesForModel("orcarouter", "deepseek/deepseek-v4-pro")).toMatchObject({
      contextWindow: 1048576,
      maxOutput: 384000,
      reasoning: true,
      thinkingFormat: "openai",
    });
  });

  it("exposes the registry 1M context for the Qwen3.7 Max entry", () => {
    expect(getCapabilitiesForModel("orcarouter", "qwen/qwen3.7-max")).toMatchObject({
      contextWindow: 1000000,
      maxOutput: 64000,
      reasoning: true,
      thinkingFormat: "openai",
    });
  });

  it("keeps the MiniMax M2.7 override from the first fix", () => {
    const caps = getCapabilitiesForModel("orcarouter", "minimax/minimax-m2.7");
    expect(caps.maxOutput).toBe(2048);
    expect(caps.thinkingFormat).toBe("openai");
    expect(caps.reasoning).toBe(true);
  });
});

describe("PR #46 review: Nous Hermes 4 capability overrides", () => {
  it("exposes 128k context and reasoning for Hermes-4-405B", () => {
    const caps = getCapabilitiesForModel("nous-research", "Hermes-4-405B");
    expect(caps.contextWindow).toBe(128000);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
  });

  it("exposes 128k context and reasoning for Hermes-4-70B", () => {
    const caps = getCapabilitiesForModel("nous-research", "Hermes-4-70B");
    expect(caps.contextWindow).toBe(128000);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
  });
});

describe("PR #46 review: modelscope suggested-models filter", () => {
  it("registers an 'openai' FILTERS entry (was missing, causing 400s)", () => {
    expect(typeof FILTERS.openai).toBe("function");
  });

  it("reshapes a raw /v1/models list into { id, name }", () => {
    const raw = [{ id: "Qwen/Qwen3-235B-A22B-Instruct-2507" }, { id: "openai/gpt-oss-120b" }];
    expect(FILTERS.openai(raw)).toEqual([
      { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", name: "Qwen/Qwen3-235B-A22B-Instruct-2507" },
      { id: "openai/gpt-oss-120b", name: "openai/gpt-oss-120b" },
    ]);
  });

  it("modelscope's modelsFetcher type matches a real filter", () => {
    expect(FILTERS[modelscope.modelsFetcher.type]).toBeDefined();
  });

  it("registers an 'ollama' FILTERS entry (was missing, causing 400s)", () => {
    expect(typeof FILTERS.ollama).toBe("function");
  });

  it("ollama-cloud's modelsFetcher type matches a real filter", () => {
    expect(FILTERS[ollamaCloudRegistry.modelsFetcher.type]).toBeDefined();
  });

  it("reshapes a raw Ollama /api/tags list into { id, name }", () => {
    const raw = [{ name: "llama3:latest" }, { name: "qwen2.5:72b" }];
    expect(FILTERS.ollama(raw)).toEqual([
      { id: "llama3:latest", name: "llama3:latest" },
      { id: "qwen2.5:72b", name: "qwen2.5:72b" },
    ]);
  });

  it("handles non-array input defensively", () => {
    expect(FILTERS.openai(null)).toEqual([]);
    expect(FILTERS.openai(undefined)).toEqual([]);
    expect(FILTERS.ollama(null)).toEqual([]);
  });
});

describe("PR #46 review: modelscope suggested-models auth proxy", () => {
  it("includes Authorization when an active modelscope connection has an API key", async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = vi.fn((url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });
    getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "modelscope", apiKey: "ms-sk-123", isActive: true },
    ]);
    try {
      vi.resetModules();
      const { GET } = await import("../../src/app/api/providers/suggested-models/route.js");
      const req = new Request(
        "http://localhost/api/providers/suggested-models?url=https://api-inference.modelscope.cn/v1/models&type=openai&provider=modelscope"
      );
      await GET(req);
      expect(calls).toHaveLength(1);
      expect(calls[0].init?.headers?.Authorization).toBe("Bearer ms-sk-123");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("skips Authorization when the URL does not match the modelscope fetcher", async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = vi.fn((url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });
    getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "modelscope", apiKey: "ms-sk-123", isActive: true },
    ]);
    try {
      vi.resetModules();
      const { GET } = await import("../../src/app/api/providers/suggested-models/route.js");
      const req = new Request(
        "http://localhost/api/providers/suggested-models?url=https://evil.example.com/v1/models&type=openai&provider=modelscope"
      );
      await GET(req);
      expect(calls).toHaveLength(1);
      expect(calls[0].init?.headers?.Authorization).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("PR #46 review: provider capability overrides", () => {
  it("orcarouter minimax-m2.7 uses the registry 2048 max output cap", () => {
    const caps = getCapabilitiesForModel("orcarouter", "minimax/minimax-m2.7");
    expect(caps.maxOutput).toBe(2048);
    expect(caps.thinkingFormat).toBe("openai");
  });

  it("morph-dsv4flash exposes the registry 1M context window", () => {
    const caps = getCapabilitiesForModel("morph", "morph-dsv4flash");
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.thinkingFormat).toBe("openai");
  });

  it("pioneer Qwen model uses OpenAI reasoning wire format", () => {
    const caps = getCapabilitiesForModel("pioneer", "Qwen/Qwen3-32B");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
  });

  it("openadapter glm-4.7 uses OpenAI reasoning wire format and 128K context", () => {
    const caps = getCapabilitiesForModel("openadapter", "glm-4.7");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
    expect(caps.contextWindow).toBe(128000);
  });

  it("nanogpt Claude model is marked non-reasoning", () => {
    const caps = getCapabilitiesForModel("nanogpt", "claude-3.5-sonnet");
    expect(caps.reasoning).toBe(false);
  });

  it("publicai Qwen model is marked non-reasoning", () => {
    const caps = getCapabilitiesForModel("publicai", "aisingapore/Qwen-SEA-LION-v4-32B-IT");
    expect(caps.reasoning).toBe(false);
  });
});
