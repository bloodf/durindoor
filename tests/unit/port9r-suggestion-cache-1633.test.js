import { afterEach, expect, it, vi } from "vitest";
import { fetchSuggestedModels } from "../../src/shared/utils/providerModelsFetcher.js";

afterEach(() => vi.unstubAllGlobals());

it("keeps catalogs with the same URL but different types separate", async () => {
  const fetchMock = vi.fn(async (url) => ({
    ok: true,
    json: async () => ({ data: [new URL(url, "http://localhost").searchParams.get("type")] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const url = "https://example.com/port1633";
  expect(await fetchSuggestedModels({ url, type: "image" })).toEqual(["image"]);
  expect(await fetchSuggestedModels({ url, type: "stt" })).toEqual(["stt"]);
  expect(await fetchSuggestedModels({ url, type: "image" })).toEqual(["image"]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
