import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_TTL_MS, fetchSuggestedModels } from "@/shared/utils/providerModelsFetcher.js";

describe("provider model cache", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses a six-hour cache and supports manual bypass", async () => {
    expect(CACHE_TTL_MS).toBe(6 * 60 * 60 * 1000);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "a" }] }) });
    const fetcher = { url: "https://models.example.test", type: "openai" };
    await fetchSuggestedModels(fetcher);
    await fetchSuggestedModels(fetcher);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchSuggestedModels(fetcher, { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
