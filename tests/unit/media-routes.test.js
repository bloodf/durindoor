/**
 * Default media routes: requests without a model run the endpoint's route.
 * Candidates come only from what /v1/models/{kind} publishes (connected
 * providers with a model of that kind); the code ships no default model.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ buildModelsList: vi.fn(), working: vi.fn(async () => true) }));
vi.mock("@/app/api/v1/models/buildModelsList.js", () => ({ buildModelsList: mocks.buildModelsList }));
vi.mock("../../src/sse/services/keylessAvailability.js", () => ({ isKeylessProviderWorking: mocks.working }));

const {
  wantsDefaultRoute,
  normalizeMediaRoutes,
  normalizeRouteModels,
  resolveMediaRoute,
  describeMediaRoute,
  MAX_ROUTE_MODELS
} = await import("../../src/sse/services/mediaRoutes.js");

const model = (id, extra = {}) => ({ id, object: "model", owned_by: id.split("/")[0], ...extra });

beforeEach(() => {
  mocks.buildModelsList.mockReset();
});

describe("wantsDefaultRoute", () => {
  it("treats a missing, empty, or auto model as a route request", () => {
    for (const value of [undefined, null, "", "  ", "auto", "AUTO", " auto "]) expect(wantsDefaultRoute(value)).toBe(true);
  });
  it("keeps explicit models and non-strings out of the route", () => {
    for (const value of ["openai/tts-1", "my-combo", "auto/coding", 0, {}]) expect(wantsDefaultRoute(value)).toBe(false);
  });
});

describe("route validation", () => {
  it("trims and de-duplicates model ids", () => {
    expect(normalizeRouteModels([" openai/tts-1", "openai/tts-1", "el/voice"])).toEqual(["openai/tts-1", "el/voice"]);
  });
  it("rejects non-lists, non-strings, ids without a provider, and oversized routes", () => {
    expect(normalizeRouteModels("openai/tts-1")).toBeNull();
    expect(normalizeRouteModels([1])).toBeNull();
    expect(normalizeRouteModels(["tts-1"])).toBeNull();
    expect(normalizeRouteModels(Array.from({ length: MAX_ROUTE_MODELS + 1 }, (_, i) => `p/m${i}`))).toBeNull();
  });
  it("accepts only known kinds in the settings map", () => {
    expect(normalizeMediaRoutes({ tts: ["openai/tts-1"], image: [] })).toEqual({ tts: ["openai/tts-1"], image: [] });
    expect(normalizeMediaRoutes({ chat: ["openai/gpt-5"] })).toBeNull();
    expect(normalizeMediaRoutes([])).toBeNull();
    expect(normalizeMediaRoutes(null)).toBeNull();
  });
});

describe("resolveMediaRoute", () => {
  it("uses every connected model of the kind, in catalog order, when nothing is saved", async () => {
    mocks.buildModelsList.mockResolvedValue([
      model("openai/tts-1"),
      model("tts-combo", { owned_by: "combo" }),
      model("el/eleven_v3")
    ]);
    const route = await resolveMediaRoute("tts", { settings: {} });
    expect(route.models).toEqual(["openai/tts-1", "el/eleven_v3"]);
    expect(mocks.buildModelsList).toHaveBeenCalledWith(["tts"], expect.anything(), { exposeComboOnly: false });
  });

  it("drops keyless providers that are not installed and working", async () => {
    mocks.buildModelsList.mockResolvedValue([model("local-whisper/whisper-1"), model("openai/whisper-1")]);
    mocks.working.mockImplementation(async (p) => p !== "local-whisper");
    const route = await resolveMediaRoute("stt", { settings: {} });
    expect(route.models).toEqual(["openai/whisper-1"]);
    mocks.working.mockImplementation(async () => true);
  });

  it("follows the saved order and skips saved models that are no longer available", async () => {
    mocks.buildModelsList.mockResolvedValue([model("openai/tts-1"), model("el/eleven_v3"), model("dg/aura")]);
    const settings = { mediaRoutes: { tts: ["dg/aura", "gone/voice", "openai/tts-1"] } };
    const route = await resolveMediaRoute("tts", { settings });
    expect(route.models).toEqual(["dg/aura", "openai/tts-1"]);
  });

  it("returns no_provider_for_kind when no connected provider has a model of the kind", async () => {
    mocks.buildModelsList.mockResolvedValue([]);
    const { error } = await resolveMediaRoute("music", { settings: {} });
    expect(error.status).toBe(400);
    const body = await error.json();
    expect(body.error.code).toBe("no_provider_for_kind");
    expect(body.error.message).toContain("No connected provider supports music generation");
  });

  it("explains a saved route whose models are all gone", async () => {
    mocks.buildModelsList.mockResolvedValue([model("openai/tts-1")]);
    const { error } = await resolveMediaRoute("tts", { settings: { mediaRoutes: { tts: ["gone/voice"] } } });
    const body = await error.json();
    expect(body.error.code).toBe("no_provider_for_kind");
    expect(body.error.message).toContain("route are available");
  });

  it("never falls through to a second embedding model", async () => {
    mocks.buildModelsList.mockResolvedValue([model("openai/text-embedding-3-small"), model("gemini/embedding-001")]);
    const route = await resolveMediaRoute("embedding", { settings: {} });
    expect(route.models).toEqual(["openai/text-embedding-3-small"]);
  });

  it("keeps web entries of the requested kind only", async () => {
    mocks.buildModelsList.mockResolvedValue([
      model("tavily/search", { kind: "webSearch" }),
      model("tavily/fetch", { kind: "webFetch" })
    ]);
    const route = await resolveMediaRoute("webFetch", { settings: {} });
    expect(route.models).toEqual(["tavily/fetch"]);
  });

  it("uses the endpoint's automatic list when it can run none of the saved models", async () => {
    mocks.buildModelsList.mockResolvedValue([model("veoaifree-web/veo"), model("xai/grok-imagine-video")]);
    const settings = { mediaRoutes: { video: ["veoaifree-web/veo"] } };
    const route = await resolveMediaRoute("video", { settings, supports: (p) => p === "xai" });
    expect(route.models).toEqual(["xai/grok-imagine-video"]);
  });

  it("still errors when the saved models are gone everywhere", async () => {
    mocks.buildModelsList.mockResolvedValue([model("xai/grok-imagine-video")]);
    const settings = { mediaRoutes: { video: ["gone/model"] } };
    const { error } = await resolveMediaRoute("video", { settings, supports: (p) => p === "xai" });
    expect(error.status).toBe(400);
  });

  it("applies an endpoint's provider filter", async () => {
    mocks.buildModelsList.mockResolvedValue([model("xai/grok-imagine-video"), model("veoaifree-web/veo")]);
    const route = await resolveMediaRoute("video", { settings: {}, supports: (p) => p === "veoaifree-web" });
    expect(route.models).toEqual(["veoaifree-web/veo"]);
  });

  it("describes saved, available, and effective models for the dashboard", async () => {
    mocks.buildModelsList.mockResolvedValue([model("openai/dall-e-3", { name: "DALL-E 3" }), model("xai/grok-imagine-image")]);
    const view = await describeMediaRoute("image", { settings: { mediaRoutes: { image: ["xai/grok-imagine-image", "gone/x"] } } });
    expect(view.saved).toEqual(["xai/grok-imagine-image", "gone/x"]);
    expect(view.candidates.map((c) => c.id)).toEqual(["openai/dall-e-3", "xai/grok-imagine-image"]);
    expect(view.models).toEqual(["xai/grok-imagine-image"]);
  });
});
