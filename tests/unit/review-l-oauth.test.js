import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns";
const mocks = vi.hoisted(() => ({ create: vi.fn(), exchange: vi.fn(), generate: vi.fn(), provider: vi.fn() }));
vi.mock("@/models", () => ({ createProviderConnection: mocks.create, getProxyPoolById: vi.fn() }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("@/lib/oauth/providers.js", async (original) => ({ ...await original(), getProvider: mocks.provider, exchangeTokens: mocks.exchange, generateAuthData: mocks.generate }));
import { clearOAuthFlowsForTests } from "@/lib/oauth/flowStore.js";
async function post(provider, action, body) {
  const { POST } = await import("@/app/api/oauth/[provider]/[action]/route.js");
  return POST({ json: async () => body }, { params: Promise.resolve({ provider, action }) });
}
describe("OAuth issue 2200 regressions", () => {
  beforeEach(() => { vi.clearAllMocks(); clearOAuthFlowsForTests(); mocks.create.mockImplementation(async (data) => ({ id: "connection", ...data })); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("rejects metadata PAT targets without sending credentials", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/oauth/gitlab/pat/route.js");
    const res = await POST({ json: async () => ({ token: "private", baseUrl: "http://169.254.169.254" }) });
    expect(res.status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not disclose a PAT verification error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret-upstream-body", { status: 401 })));
    const { POST } = await import("@/app/api/oauth/gitlab/pat/route.js");
    const res = await POST({ json: async () => ({ token: "private", baseUrl: "https://gitlab.com" }) });
    expect(await res.text()).not.toContain("secret-upstream-body");
  });
  it("rejects a PAT hostname resolving to metadata", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/oauth/gitlab/pat/route.js");
    expect((await POST({ json: async () => ({ token: "private", baseUrl: "https://example.com" }) })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("returns 400 for an invalid import expiry", async () => {
    mocks.provider.mockReturnValue({ flowType: "import_token", mapTokens: () => ({ accessToken: "token", expiresIn: "abc" }) });
    expect((await post("windsurf", "import-token", { accessToken: "token" })).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("exchanges JWT-shaped Claude codes instead of storing them", async () => {
    mocks.provider.mockReturnValue({ flowType: "authorization_code_pkce" });
    mocks.generate.mockResolvedValue({ authUrl: "https://example.com", state: "state", codeVerifier: "verifier", flowType: "authorization_code_pkce" });
    mocks.exchange.mockResolvedValue({ accessToken: "exchanged" });
    const auth = await post("claude", "authorize", { proxyMode: "direct" });
    const { flowId } = await auth.json();
    const res = await post("claude", "exchange", { code: "eyJ.e30.sig", state: "state", flowId });
    expect(res.status).toBe(200); expect(mocks.exchange.mock.calls[0].slice(0, 2)).toEqual(["claude", "eyJ.e30.sig"]);
  });
  it.each(["gitlab", "gitlab-duo"])("blocks private OAuth endpoints for %s", async (provider) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { getProvider } = await vi.importActual("@/lib/oauth/providers.js"); const definition = getProvider(provider);
    await expect(definition.exchangeToken(definition.config, "code", "http://localhost", "verifier", "state", { baseUrl: "http://169.254.169.254" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not send the configured Duo secret to another instance or expose error bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("secret-upstream-body", { status: 400 })); vi.stubGlobal("fetch", fetchMock);
    const { getProvider } = await vi.importActual("@/lib/oauth/providers.js"); const definition = getProvider("gitlab-duo");
    const config = { ...definition.config, defaultBaseUrl: "https://gitlab.com", clientSecret: "env-secret" };
    await expect(definition.exchangeToken(config, "code", "http://localhost", "verifier", "state", { baseUrl: "https://example.com" })).rejects.not.toThrow("secret-upstream-body");
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).has("client_secret")).toBe(false);
  });
  it("sends the configured Duo secret to its configured instance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("failure", { status: 400 })); vi.stubGlobal("fetch", fetchMock);
    const { getProvider } = await vi.importActual("@/lib/oauth/providers.js"); const definition = getProvider("gitlab-duo");
    const config = { ...definition.config, defaultBaseUrl: "https://gitlab.com", clientSecret: "env-secret" };
    await expect(definition.exchangeToken(config, "code", "http://localhost", "verifier", "state", {})).rejects.toThrow();
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("client_secret")).toBe("env-secret");
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });
});
