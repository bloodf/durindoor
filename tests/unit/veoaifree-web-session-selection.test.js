// Veo AI Free connection selection through the real auth selector: anonymous
// with no saved session, the selected saved session otherwise, and never a
// silent anonymous fallback once a session exists. The public anonymous
// fallback roster is unchanged. Closed mocks only; synthetic cookie values.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: mocks.getProviderConnectionById,
  getApiKeyByKey: mocks.getApiKeyByKey,
  validateApiKey: mocks.validateApiKey,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
  getApiKeyProviderConnectionIds: mocks.getApiKeyProviderConnectionIds,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: mocks.pickProxyPoolId,
}));

const { getNoAuthProviderCredentials, getProviderCredentials, providerAllowsPublicNoAuthFallback } = await import("../../src/sse/services/auth.js");
const { createVeoAiFreeVideoAdapter } = await import("../../open-sse/services/providerParity/native-veoaifree-web-video/index.js");

const WP = "wordpress_logged_in_04e805bfa8c7064a04c2e480966a748b";
const row = (id, value, extra = {}) => ({ id, provider: "veoaifree-web", authType: "apikey", name: id, apiKey: `${WP}=${value}`, isActive: true, priority: 1, providerSpecificData: {}, ...extra });

async function generate(credentials) {
  const answers = [new Response('{"nonce":"abcdef"}'), new Response("scene-1"), new Response("https://cdn.example.com/video.mp4")];
  const fetchImpl = vi.fn(async () => answers.shift());
  vi.stubGlobal("fetch", fetchImpl);
  const result = await createVeoAiFreeVideoAdapter({ pollIntervalMs: 0 }).generate({ model: "veo", body: { prompt: "rain" }, credentials });
  expect(result.success).toBe(true);
  return fetchImpl.mock.calls.map(([url, init]) => ({ url, cookie: init.headers.Cookie, authorization: init.headers.Authorization }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({});
  mocks.getProxyPools.mockResolvedValue([]);
  mocks.getQuotaReservationPressure.mockResolvedValue(null);
  mocks.getApiKeyProviderConnectionIds.mockResolvedValue([]);
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.updateProviderConnection.mockImplementation(async (id) => null);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("veoaifree-web connection selection", () => {
  it("stays anonymous with no saved session and keeps the public fallback roster unchanged", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    expect(await getNoAuthProviderCredentials("veoaifree-web", "veo", {})).toEqual({});
    expect(providerAllowsPublicNoAuthFallback("veoaifree-web")).toBe(false);
    expect(await getProviderCredentials("veoaifree-web")).toBeNull();
    const calls = await generate({});
    expect(calls.map((call) => call.cookie)).toEqual([undefined, undefined, undefined]);
    expect(calls.every((call) => call.authorization === undefined)).toBe(true);
  });

  it("selects the saved session instead of discarding it as no-auth", async () => {
    mocks.getProviderConnections.mockResolvedValue([row("veo-a", "session-a")]);
    const credentials = await getNoAuthProviderCredentials("veoaifree-web", "veo", {});
    expect(credentials).toMatchObject({ connectionId: "veo-a", apiKey: `${WP}=session-a` });
    const calls = await generate(credentials);
    expect(calls[0]).toEqual({ url: "https://veoaifree.com", cookie: undefined, authorization: undefined });
    expect(calls.slice(1).map((call) => call.cookie)).toEqual([`${WP}=session-a`, `${WP}=session-a`]);
  });

  it("pins each of two sessions by connection id and keeps their cookies apart", async () => {
    mocks.getProviderConnections.mockResolvedValue([row("veo-a", "session-a"), row("veo-b", "session-b", { priority: 2 })]);
    const pin = (id) => getNoAuthProviderCredentials("veoaifree-web", "veo", { preferredConnectionId: id, strictConnectionId: id });
    const a = await pin("veo-a");
    const b = await pin("veo-b");
    expect([a.connectionId, b.connectionId]).toEqual(["veo-a", "veo-b"]);
    const sentA = await generate(a);
    const sentB = await generate(b);
    expect(sentA.slice(1).every((call) => call.cookie === `${WP}=session-a`)).toBe(true);
    expect(sentB.slice(1).every((call) => call.cookie === `${WP}=session-b`)).toBe(true);
    expect(await pin("veo-missing")).toBeNull();
  });

  it("never falls back to anonymous when the saved sessions are unavailable", async () => {
    mocks.getProviderConnections.mockResolvedValue([row("veo-a", "session-a")]);
    expect(await getProviderCredentials("veoaifree-web", new Set(["veo-a"]), "veo", { noAuthPath: true })).toBeNull();
  });

  it("lets a scoped caller key use only its related session, never anonymous", async () => {
    mocks.getProviderConnections.mockResolvedValue([row("veo-a", "session-a"), row("veo-b", "session-b")]);
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue(["veo-b"]);
    expect(await getNoAuthProviderCredentials("veoaifree-web", "veo", { apiKeyId: "caller" })).toMatchObject({ connectionId: "veo-b" });
    mocks.getProviderConnections.mockResolvedValue([]);
    expect(await getNoAuthProviderCredentials("veoaifree-web", "veo", { apiKeyId: "caller" })).toBeNull();
  });
});
