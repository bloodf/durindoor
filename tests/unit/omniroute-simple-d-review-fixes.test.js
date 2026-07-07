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
import { describe, expect, it, vi } from "vitest";
import openadapter from "../../open-sse/providers/registry/openadapter.js";
import modelscope from "../../open-sse/providers/registry/modelscope.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

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
  it("marks Mistral-Small-3.2-24B-Instruct-2506 as vision-capable", async () => {
    const { default: ovhcloud } = await import("../../open-sse/providers/registry/ovhcloud.js");
    const model = ovhcloud.models.find((m) => m.id === "Mistral-Small-3.2-24B-Instruct-2506");
    expect(model?.supportsVision).toBe(true);
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

  it("handles non-array input defensively", () => {
    expect(FILTERS.openai(null)).toEqual([]);
    expect(FILTERS.openai(undefined)).toEqual([]);
  });
});
