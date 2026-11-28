// decolua/9router#4674: Cline's /api/v1/models stopped listing cline-pass/* ids; the
// recommended-models feed's clinePass[] tier is the live source. DurinDoor exposes
// short ids, so unlisted ones must regain the cline-pass/ prefix on the wire.
// Offline: global fetch is stubbed for every case.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveClinepassModels } from "../../open-sse/services/catalogs/clinepassModels.js";
import { getModelUpstreamId, PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

const MODELS_URL = "https://api.cline.bot/api/v1/models";
const FEED_URL = "https://api.cline.bot/api/v1/ai/cline/recommended-models";
const json = (obj, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => obj });

function stubRoutes(routes) {
  const fetchMock = vi.fn(async (url) => routes[String(url)] ?? json({}, false));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("decolua/9router#4674 ClinePass live catalog", () => {
  it("reads the feed's clinePass tier without credentials, ignoring other tiers", async () => {
    const fetchMock = stubRoutes({
      [FEED_URL]: json({
        free: [{ id: "cline-free/x" }],
        clinePass: [{ id: "cline-pass/glm-5.3", name: "GLM-5.3" }, { id: "cline-pass/kimi-k3" }, { id: "z-ai/other" }],
      }),
    });

    await expect(resolveClinepassModels({ apiKey: "feed-key" })).resolves.toEqual({
      models: [
        { id: "glm-5.3", name: "GLM-5.3", upstreamModelId: "cline-pass/glm-5.3" },
        { id: "kimi-k3", name: "kimi-k3", upstreamModelId: "cline-pass/kimi-k3" },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });

  it.each([
    ["the feed tier has no cline-pass ids", { [FEED_URL]: json({ clinePass: [{ id: "z-ai/glm-5.3" }] }) }],
    ["the feed is down", {}],
  ])("falls back to /api/v1/models when %s", async (_case, routes) => {
    stubRoutes({ ...routes, [MODELS_URL]: json([{ id: "cline-pass/glm-5.3" }, { id: "z-ai/glm-5.3" }]) });
    const result = await resolveClinepassModels({ apiKey: "fallback-key" });
    expect(result.models.map((model) => model.id)).toEqual(["glm-5.3"]);
  });

  it("returns null when neither source lists a ClinePass model", async () => {
    stubRoutes({ [MODELS_URL]: json([{ id: "z-ai/glm-5.3" }]) });
    await expect(resolveClinepassModels({ apiKey: "empty-key" })).resolves.toBeNull();
  });

  it("sends a feed-only short id with the cline-pass/ prefix and keeps namespaced ids", () => {
    expect(getModelUpstreamId("clinepass", "not-in-static-list")).toBe("cline-pass/not-in-static-list");
    expect(getModelUpstreamId("clinepass", "cline-pass/glm-5.3")).toBe("cline-pass/glm-5.3");
  });

  it("drops the retired ids from the static fallback and lists the current ones", () => {
    const ids = PROVIDER_MODELS.clinepass.map((model) => model.id);
    for (const retired of ["glm-5.2", "kimi-k2.6", "kimi-k2.7-code", "deepseek-v4-flash"]) {
      expect(ids).not.toContain(retired);
    }
    expect(ids).toHaveLength(14);
    expect(ids).toContain("kimi-k3");
    for (const id of ids) expect(getModelUpstreamId("clinepass", id)).toBe(`cline-pass/${id}`);
  });
});
