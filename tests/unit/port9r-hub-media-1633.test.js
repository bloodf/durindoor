import { describe, expect, it, vi } from "vitest";
import { FILTERS } from "@/app/api/providers/suggested-models/filters.js";
import { GET, isAllowedSuggestedModelsFetcher } from "@/app/api/providers/suggested-models/route.js";
import { getProviderModelsFetcher } from "@/shared/constants/providers.js";
import image from "../../open-sse/handlers/imageProviders/huggingface.js";
import registry from "../../open-sse/providers/registry/huggingface.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";

describe("Hub media suggestions", () => {
  it("allows only registered discovery URLs and filters images to executable mappings", async () => {
    const fetcher = getProviderModelsFetcher("huggingface", "image");
    expect(isAllowedSuggestedModelsFetcher(fetcher.url, fetcher.type)).toBe(true);
    expect(isAllowedSuggestedModelsFetcher("http://127.0.0.1", fetcher.type)).toBe(false);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json([
      { id: "unknown/model", downloads: 100 },
      { id: "Qwen/Qwen-Image-Edit", downloads: 99 },
      { id: "Qwen/Qwen-Image", downloads: 10 },
    ]));
    try {
      const response = await GET(new Request(`http://localhost/api/providers/suggested-models?${new URLSearchParams(fetcher)}`));
      const { data } = await response.json();
      expect(data.map((m) => m.id)).toEqual(["Qwen/Qwen-Image"]);
      expect(fetch).toHaveBeenCalledWith(fetcher.url, { redirect: "error" });
      expect(image.buildUrl(data[0].id, {})).toBe("https://router.huggingface.co/fal-ai/fal-ai/qwen-image");
      expect(await image.buildBody(data[0].id, { prompt: "test" })).toEqual({ inputs: "test" });
    } finally { fetch.mockRestore(); }
  });

  it("discovers and executes hf-inference speech models", async () => {
    const fetcher = getProviderModelsFetcher("huggingface", "stt");
    expect(isAllowedSuggestedModelsFetcher(fetcher.url, fetcher.type)).toBe(true);
    const [model] = FILTERS[fetcher.type]([{ id: "openai/whisper-large-v3" }, { id: "../bad" }]);
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ text: "hello" }));
    const restore = __setOriginalFetchForTesting(fetch);
    try {
      const formData = new FormData();
      formData.append("file", new File(["audio"], "audio.wav", { type: "audio/wav" }));
      const result = await handleSttCore({ provider: "huggingface", model: model.id, formData, credentials: { apiKey: "key" }, sttConfig: registry.sttConfig });
      expect(fetch.mock.calls[0][0]).toBe("https://router.huggingface.co/hf-inference/models/openai%2Fwhisper-large-v3");
      expect(await result.response.json()).toMatchObject({ text: "hello" });
    } finally { restore(); }
  });
});
