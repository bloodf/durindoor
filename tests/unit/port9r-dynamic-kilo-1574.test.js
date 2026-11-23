import { describe, expect, it, vi } from "vitest";
import { mergeLiveCatalogs, liveCatalogModelEntries } from "@/shared/utils/liveCatalogModels";
import { LIVE_CATALOG_PROVIDERS } from "@/shared/constants/providers";
import { fetchConnectionModels } from "@/app/api/providers/[id]/models/fetchConnectionModels";

const url = "https://api.kilo.ai/api/gateway/models";

describe("Kilo live catalog", () => {
  it("fetches a fixed public catalog without credentials and merges paid and free models", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(Response.json({ data: [
      { id: "paid/model", name: "Paid" }, { id: "free/model", isFree: true }, { name: "invalid" },
    ] }));
    try {
      expect(await fetchConnectionModels({ provider: "kilocode" })).toEqual({ error: "Kilo catalog unavailable", status: 502 });
      const result = await fetchConnectionModels({ provider: "kilocode", apiKey: "secret", providerSpecificData: { baseUrl: "http://127.0.0.1" } });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][0]).toBe(url);
      expect(fetcher.mock.calls[1][1]).toMatchObject({ headers: { Accept: "application/json" }, redirect: "manual" });
      expect(result.models).toEqual([{ id: "paid/model", name: "Paid" }, { id: "free/model", name: "free/model" }]);
      expect(LIVE_CATALOG_PROVIDERS).toContain("kilocode");
      expect(liveCatalogModelEntries("kc", mergeLiveCatalogs([result.models, result.models])).map((m) => m.value)).toEqual(["kc/paid/model", "kc/free/model"]);
      await fetchConnectionModels({ provider: "kilocode" });
      expect(fetcher).toHaveBeenCalledTimes(2);
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60 * 60 * 1000 + 1);
      fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
      expect(await fetchConnectionModels({ provider: "kilocode" })).toEqual({ models: result.models, warning: "Kilo catalog refresh failed" });
      clock.mockRestore();
    } finally { fetcher.mockRestore(); }
  });
});
