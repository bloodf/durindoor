import { beforeEach, describe, expect, test, vi } from "vitest";
import { clearKimchiCatalog, resolveKimchiModels } from "../../open-sse/services/catalogs/kimchiModels.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

describe("Kimchi catalog credential isolation", () => {
  beforeEach(() => {
    clearKimchiCatalog();
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockImplementation(async (_url, init) => {
      const id = init.headers.Authorization === "Bearer fake-first" ? "first-model" : "second-model";
      return Response.json({ models: [{ id }] });
    });
  });

  test("does not reuse a catalog for different tokens sharing a profile", async () => {
    const profile = { userId: "same-profile" };
    const first = await resolveKimchiModels({ accessToken: "fake-first", providerSpecificData: profile });
    const second = await resolveKimchiModels({ accessToken: "fake-second", providerSpecificData: profile });
    expect(first.models[0].id).toBe("first-model");
    expect(second.models[0].id).toBe("second-model");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });
});
