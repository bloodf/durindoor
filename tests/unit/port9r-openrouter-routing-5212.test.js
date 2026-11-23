import { describe, expect, it } from "vitest";
import { applyOpenRouterRouting, normalizeOpenRouterRouting } from "../../open-sse/services/openrouterRouting.js";

describe("OpenRouter provider routing", () => {
  it("validates saved policy and cannot weaken ZDR or precision", () => {
    expect(() => normalizeOpenRouterRouting({ zdr: "true" })).toThrow();
    expect(() => normalizeOpenRouterRouting({ quantizations: ["bogus"] })).toThrow();
    expect(() => normalizeOpenRouterRouting({ extra: true })).toThrow();
    const body = { model: "meta/llama", provider: { zdr: false, quantizations: ["fp8", "fp16"] } };
    expect(applyOpenRouterRouting(body, { zdr: true, quantizations: ["fp16", "bf16"] }, "completion")).toEqual({ model: "meta/llama", provider: { zdr: true, quantizations: ["fp16"] } });
    expect(body.provider.zdr).toBe(false);
    expect(() => applyOpenRouterRouting(body, { quantizations: ["int4"] }, "embedding")).toThrow(/conflict/);
  });
  it("handles undisclosed precision and mixed model fallbacks", () => {
    const policy = { quantizations: ["fp16"] };
    expect(applyOpenRouterRouting({ model: "openai/gpt-4o" }, policy, "completion").provider).toBeUndefined();
    expect(applyOpenRouterRouting({ model: "openai/gpt-4o", models: ["google/gemma-3"] }, policy, "completion").provider.quantizations).toEqual(["fp16"]);
    expect(applyOpenRouterRouting({ model: "openai/gpt-oss-120b" }, policy, "systemone").provider.quantizations).toEqual(["fp16"]);
  });
  it.each(["image", "video"])("blocks %s under ZDR unless the saved exception applies", (endpoint) => {
    const exception = endpoint === "image" ? "allowImageWithoutZdr" : "allowVideoWithoutZdr";
    expect(() => applyOpenRouterRouting({}, { zdr: true }, endpoint)).toThrow(/blocked/);
    expect(applyOpenRouterRouting({}, { zdr: true, [exception]: true }, endpoint)).toEqual({});
    expect(() => applyOpenRouterRouting({ provider: { zdr: true } }, { zdr: true, [exception]: true }, endpoint)).toThrow(/blocked/);
  });
});

describe("operator routing settings API", () => {
  it("rejects unprivileged writes, validates policies, and stores operator changes", async () => {
    const { vi } = await import("vitest");
    const state = { allowed: false, value: null };
    vi.doMock("@/lib/settings/settingsPatchAuth", () => ({ canModifySecurityCriticalSettings: async () => state.allowed }));
    vi.doMock("@/lib/localDb", () => ({ getSettings: async () => ({ openrouterRouting: state.value }), updateSettings: async (patch) => { state.value = patch.openrouterRouting; } }));
    const route = await import("../../src/app/api/providers/openrouter/routing/route.js");
    const request = (routing) => new Request("http://localhost/api/providers/openrouter/routing", { method: "PUT", body: JSON.stringify({ routing }) });
    expect((await route.PUT(request({ zdr: true }))).status).toBe(403);
    expect(state.value).toBeNull();
    state.allowed = true;
    expect((await route.PUT(request({ zdr: "yes" }))).status).toBe(400);
    expect((await route.PUT(request({ zdr: true }))).status).toBe(200);
    expect(await (await route.GET(new Request("http://localhost"))).json()).toEqual({ routing: { zdr: true } });
    vi.doUnmock("@/lib/settings/settingsPatchAuth");
    vi.doUnmock("@/lib/localDb");
  });
});

describe("OpenRouter TTS transport", () => {
  it("sends saved ZDR and blocks the unverified speech fallback", async () => {
    const { vi } = await import("vitest");
    const { default: adapter } = await import("../../open-sse/handlers/ttsProviders/openrouter.js");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: "is a text-to-speech model" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(adapter.synthesize("hello", "vendor/model", { apiKey: "test" }, "mp3", { routingPolicy: { zdr: true } })).rejects.toThrow(/cannot enforce/);
      expect(JSON.parse(fetcher.mock.calls[0][1].body).provider.zdr).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("OpenRouter embeddings transport", () => {
  it("applies restrictions before dispatch and rejects conflicts", async () => {
    const { vi } = await import("vitest");
    const { handleEmbeddingsCore } = await import("../../open-sse/handlers/embeddingsCore.js");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [], usage: { prompt_tokens: 1, total_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    try {
      const options = { body: { input: "hello", provider: { zdr: false, quantizations: ["fp16"] } }, modelInfo: { provider: "openrouter", model: "vendor/model" }, credentials: { apiKey: "test" }, routingPolicy: { zdr: true, quantizations: ["fp16"] } };
      await handleEmbeddingsCore(options);
      expect(JSON.parse(fetcher.mock.calls[0][1].body).provider).toEqual({ zdr: true, quantizations: ["fp16"] });
      const result = await handleEmbeddingsCore({ ...options, routingPolicy: { quantizations: ["int4"] } });
      expect(result.status).toBe(400);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});
