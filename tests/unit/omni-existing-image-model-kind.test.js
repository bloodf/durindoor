// #1073 / OmniRoute#18683: Leonardo and Ideogram ship image models in the chat-visible
// registry rows (so the provider page can list them) but have no chat API. They must
// classify as image-only for chat selection and for the dashboard model test, while the
// image operation keeps its precise "does not support image generation" error.
// Offline only: no network, credentials or real provider traffic.
import { afterEach, describe, expect, it, vi } from "vitest";
import { isImageOnlyModel } from "../../src/sse/handlers/chat.js";
import { isChatProvider } from "../../open-sse/providers/chatCapability.js";
import { getImageAdapter, isImageProvider } from "../../open-sse/handlers/imageProviders/index.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { getModelType, getProviderModels } from "../../open-sse/config/providerModels.js";
import { AI_PROVIDERS, getProvidersByKind } from "../../src/shared/constants/providers.js";
import { pingModelByKind } from "../../src/app/api/models/test/ping.js";
import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const EXPECTED = {
  leonardo: { alias: "leo", models: ["phoenix", "sdxl"] },
  ideogram: { alias: "ideo", models: ["V_3", "V_2A"] },
};
// Leonardo now has native image and video adapters; its video rows are the only addition.
const VIDEO_ROWS = { leonardo: ["motion-2.0", "motion-2.0-fast"] };
const entry = (id) => REGISTRY.find((e) => e.id === id);

describe("registry rows for existing Leonardo and Ideogram models", () => {
  for (const [id, { alias, models }] of Object.entries(EXPECTED)) {
    it(`${id}: every registered model is declared kind "image" and nothing else was added`, () => {
      const row = entry(id);
      const video = VIDEO_ROWS[id] ?? [];
      expect(row.alias).toBe(alias);
      expect(row.models.map((m) => m.id)).toEqual([...models, ...video]);
      for (const m of row.models) expect(m.kind).toBe(video.includes(m.id) ? "video" : "image");
      expect(getProviderModels(alias).map((m) => m.id)).toEqual([...models, ...video]);
      for (const m of models) expect(getModelType(alias, m)).toBe("image");
    });
  }
});

describe("chat selection classification", () => {
  it("treats every Leonardo and Ideogram model as image-only, by id and by alias", () => {
    for (const [id, { alias, models }] of Object.entries(EXPECTED)) {
      for (const m of models) {
        expect(isImageOnlyModel(id, m), `${id}/${m}`).toBe(true);
        expect(isImageOnlyModel(alias, m), `${alias}/${m}`).toBe(true);
      }
    }
  });

  it("does not claim chat capability for either provider", () => {
    expect(isChatProvider("leonardo")).toBe(false);
    expect(isChatProvider("ideogram")).toBe(false);
  });

  it("keeps mixed and chat providers chat-capable", () => {
    expect(isImageOnlyModel("openai", "gpt-4o")).toBe(false);
    expect(isImageOnlyModel("cloudflare-ai", "@cf/meta/llama-3.3-70b-instruct")).toBe(false);
    expect(isImageOnlyModel("cloudflare-ai", "@cf/black-forest-labs/flux-2-dev")).toBe(true);
    expect(isImageOnlyModel("leonardo", "not-a-registered-model")).toBe(false);
  });

  it("only changes classification for registered image rows: no non-image row is image-only", () => {
    const wrong = [];
    for (const e of REGISTRY) {
      for (const m of e.models || []) {
        // An id is image-only when every row with that id is an image row (Haiper gen2 is also video).
        const declaredImage = (e.models || []).filter((x) => x.id === m.id).every((x) => (x.kind ?? x.type) === "image");
        if (isImageOnlyModel(e.id, m.id) !== declaredImage) wrong.push(`${e.id}/${m.id}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("keeps the models out of the chat model catalog", async () => {
    const chat = await buildModelsList(["llm"]);
    const ids = (chat.data || chat).map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const [id, { alias, models }] of Object.entries(EXPECTED)) {
      for (const m of models) {
        expect(ids).not.toContain(`${id}/${m}`);
        expect(ids).not.toContain(`${alias}/${m}`);
      }
    }
  });
});

describe("image operation and media errors are preserved", () => {
  it("keeps both providers hidden from image provider pickers without an adapter", () => {
    // Leonardo has a native image adapter now and is listed for image and video.
    expect(AI_PROVIDERS.leonardo.hiddenKinds).toBeUndefined();
    expect(AI_PROVIDERS.leonardo.serviceKinds).toEqual(["image", "video"]);
    expect(getProvidersByKind("image").map((p) => p.id)).toContain("leonardo");
    expect(isImageProvider("leonardo")).toBe(true);
    expect(getImageAdapter("leonardo")).not.toBeNull();
    for (const id of Object.keys(EXPECTED).filter((id) => id !== "leonardo")) {
      expect(AI_PROVIDERS[id].hiddenKinds).toEqual(["image"]);
      expect(AI_PROVIDERS[id].serviceKinds).toEqual([]);
      expect(getProvidersByKind("image").map((p) => p.id)).not.toContain(id);
      expect(isImageProvider(id)).toBe(false);
      expect(getImageAdapter(id)).toBeNull();
    }
  });

  it("answers image generation with the precise unsupported-provider error", async () => {
    // Leonardo reaches its native adapter, which refuses unsupported input before any network call.
    const leonardo = await handleImageGenerationCore({
      body: { prompt: "a gate in a forest", style: "vivid" },
      modelInfo: { provider: "leonardo", model: "phoenix" },
      credentials: { apiKey: "not-a-real-key" },
    });
    expect(leonardo.success).toBe(false);
    expect(leonardo.status).toBe(400);
    expect(leonardo.error).toBe("Leonardo image generation does not support style");
    for (const [id, { models }] of Object.entries(EXPECTED).filter(([id]) => id !== "leonardo")) {
      const result = await handleImageGenerationCore({
        body: { prompt: "a gate in a forest" },
        modelInfo: { provider: id, model: models[0] },
        credentials: { apiKey: "not-a-real-key" },
      });
      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.error).toBe(`Provider '${id}' does not support image generation`);
    }
  });

  it("still reports the missing prompt before the adapter lookup", async () => {
    const result = await handleImageGenerationCore({
      body: {},
      modelInfo: { provider: "leonardo", model: "phoenix" },
      credentials: {},
    });
    expect(result.status).toBe(400);
    expect(result.error).toBe("Missing required field: prompt");
  });
});

describe("existing model-test path", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("probes image-kind models through images/generations, never chat, and surfaces the media error", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(
        JSON.stringify({ error: { message: "Provider 'leonardo' does not support image generation" } }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    });
    for (const [id, { alias, models }] of Object.entries(EXPECTED)) {
      for (const m of models) {
        const kind = getModelType(alias, m);
        expect(kind).toBe("image");
        const result = await pingModelByKind(`${alias}/${m}`, kind, "http://127.0.0.1:1");
        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        expect(result.error).toMatch(/^HTTP 400: .*does not support image generation/);
      }
    }
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.url).toBe("http://127.0.0.1:1/api/v1/images/generations");
      expect(call.body.messages).toBeUndefined();
    }
  });
});
