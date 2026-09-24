/**
 * Dashboard API for default media routes (/api/media-providers/routes) and
 * the `mediaRoutes` guard on the generic settings PATCH.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: {},
  buildModelsList: vi.fn()
}));

vi.mock("@/app/api/v1/models/buildModelsList.js", () => ({ buildModelsList: mocks.buildModelsList }));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ ...mocks.store })),
  updateSettings: vi.fn(async (updates) => {
    mocks.store = { ...mocks.store, ...updates };
    return { ...mocks.store };
  }),
  updateSettingsWithPasswordEpoch: vi.fn(),
  PasswordEpochMismatchError: class extends Error {}
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  DEFAULT_PASSWORD: "default-password",
  invalidateDefaultPasswordCache: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  validateDashboardPassword: vi.fn(),
  verifyDashboardPassword: vi.fn()
}));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ resetPasswordChangeProofs: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const { GET, PUT } = await import("../../src/app/api/media-providers/routes/route.js");
const { PATCH } = await import("../../src/app/api/settings/route.js");

const entry = (id, name) => ({ id, object: "model", owned_by: id.split("/")[0], ...(name ? { name } : null) });
const put = (body) => PUT(new Request("http://localhost/api/media-providers/routes", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
}));

beforeEach(() => {
  mocks.store = {};
  mocks.buildModelsList.mockReset();
  mocks.buildModelsList.mockImplementation(async ([kind]) => (kind === "tts"
    ? [entry("openai/tts-1", "TTS-1"), entry("elevenlabs/eleven_v3")]
    : []));
});

describe("/api/media-providers/routes", () => {
  it("lists every endpoint with its candidates and the order a no-model request runs", async () => {
    const res = await GET();
    const { routes } = await res.json();
    expect(routes.map((r) => r.id)).toEqual(["tts", "stt", "webSearch", "webFetch", "embedding", "image", "video", "music"]);
    const tts = routes.find((r) => r.id === "tts");
    expect(tts.saved).toEqual([]);
    expect(tts.candidates).toEqual([
      { id: "openai/tts-1", name: "TTS-1", provider: "openai" },
      { id: "elevenlabs/eleven_v3", name: "elevenlabs/eleven_v3", provider: "elevenlabs" }
    ]);
    expect(tts.effective).toEqual(["openai/tts-1", "elevenlabs/eleven_v3"]);
    expect(routes.find((r) => r.id === "music").effective).toEqual([]);
  });

  it("saves a route order and resets it with an empty list", async () => {
    const saved = await (await put({ kind: "tts", models: ["elevenlabs/eleven_v3", "openai/tts-1"] })).json();
    expect(saved.route.effective).toEqual(["elevenlabs/eleven_v3", "openai/tts-1"]);
    expect(mocks.store.mediaRoutes).toEqual({ tts: ["elevenlabs/eleven_v3", "openai/tts-1"] });

    await put({ kind: "image", models: ["openai/dall-e-3"] });
    expect(mocks.store.mediaRoutes.tts).toEqual(["elevenlabs/eleven_v3", "openai/tts-1"]);

    const reset = await (await put({ kind: "tts", models: [] })).json();
    expect(reset.route.saved).toEqual([]);
    expect(reset.route.effective).toEqual(["openai/tts-1", "elevenlabs/eleven_v3"]);
  });

  it("rejects unknown kinds and malformed model lists", async () => {
    expect((await put({ kind: "chat", models: [] })).status).toBe(400);
    expect((await put({ kind: "tts", models: "openai/tts-1" })).status).toBe(400);
    expect((await put({ kind: "tts", models: ["no-provider"] })).status).toBe(400);
    expect(mocks.store.mediaRoutes).toBeUndefined();
  });
});

describe("settings PATCH mediaRoutes", () => {
  const patch = (body) => PATCH(new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }));

  it("stores a normalized route map", async () => {
    const res = await patch({ mediaRoutes: { tts: [" openai/tts-1 ", "openai/tts-1"] } });
    expect(res.status).toBe(200);
    expect(mocks.store.mediaRoutes).toEqual({ tts: ["openai/tts-1"] });
  });

  it("rejects an invalid route map", async () => {
    for (const mediaRoutes of [null, [], { chat: [] }, { tts: "openai/tts-1" }]) {
      const res = await patch({ mediaRoutes });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid mediaRoutes" });
    }
  });
});
