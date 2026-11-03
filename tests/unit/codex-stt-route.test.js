// /v1/audio/transcriptions account handling for cx/transcribe (#1563). Unverified live.
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ results: [], calls: [] }));
const authMocks = vi.hoisted(() => ({
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true })),
  clearAccountError: vi.fn(async () => {}),
}));
const refreshMock = vi.hoisted(() => vi.fn(async (_p, c, _po, opts) => (opts?.force ? { ...c, accessToken: "fresh" } : c)));
const usage = vi.hoisted(() => vi.fn(async (_k, response) => response));

vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}), getApiKeyByKey: async () => null, getComboForModel: async () => null }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: "k", auth: { ok: true, apiKeyId: "kid" } }),
  hasValidCliToken: async () => false,
  getNoAuthProviderCredentials: vi.fn(),
  getProviderCredentialsWithQuotaPreflight: vi.fn(async (_p, excluded) => ({ authType: "oauth", accessToken: "old", refreshToken: "r", connectionId: excluded.size ? "b" : "a" })),
  ...authMocks,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: refreshMock }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: async (v) => { const [provider, ...m] = v.split("/"); return { provider: provider === "cx" ? "codex" : provider, model: m.join("/") }; } }));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: async () => null, recordApiKeyUsageForResponse: usage }));
vi.mock("@/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}), supportsTranslation: () => true }));
vi.mock("open-sse/handlers/sttCore.js", () => ({
  handleSttCore: async (args) => { core.calls.push(args); return core.results.shift(); },
}));

const { handleStt } = await import("@/sse/handlers/stt.js");
const request = (model = "cx/transcribe") => {
  const body = new FormData();
  body.set("model", model);
  body.set("file", new Blob(["a"], { type: "audio/wav" }), "a.wav");
  return new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body });
};
const fail = (status, local) => ({ success: false, status, error: "x", local, response: Response.json({ error: { message: "x" } }, { status }) });

beforeEach(() => { core.results = []; core.calls = []; vi.clearAllMocks(); });

describe("codex stt route", () => {
  it("rejects other codex models", async () => {
    expect((await handleStt(request("cx/gpt-5.6-sol"))).status).toBe(400);
  });

  it("does not cool down or rotate an account for a local error such as missing ffmpeg", async () => {
    core.results = [fail(503, true)];
    const response = await handleStt(request());
    expect(response.status).toBe(503);
    expect(authMocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(core.calls).toHaveLength(1);
  });

  it("falls back to the next account on an account fault", async () => {
    core.results = [fail(403, undefined), { success: true, response: Response.json({ text: "hi" }), nativeUnits: { audioSeconds: 2 } }];
    const response = await handleStt(request());
    expect(response.status).toBe(200);
    expect(authMocks.markAccountUnavailable).toHaveBeenCalledTimes(1);
    expect(authMocks.clearAccountError).toHaveBeenCalledTimes(1);
    expect(usage.mock.calls[0][2].nativeUnits).toEqual({ audioSeconds: 2 });
    expect(usage.mock.calls[0][2].endpoint).toBe("/v1/audio/transcriptions");
  });

  it("forces one token refresh and retries once on 401", async () => {
    core.results = [fail(401, undefined), { success: true, response: Response.json({ text: "hi" }), nativeUnits: { audioSeconds: 1 } }];
    const response = await handleStt(request());
    expect(response.status).toBe(200);
    expect(refreshMock.mock.calls.some((c) => c[3]?.force === true)).toBe(true);
    expect(core.calls[1].credentials.accessToken).toBe("fresh");
    expect(authMocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
});
