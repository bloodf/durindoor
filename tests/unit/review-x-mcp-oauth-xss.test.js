import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstanceById: vi.fn(), getMcpSessionStatus: vi.fn(),
  completeMcpSession: vi.fn(), clearMcpSession: vi.fn(), storeTokens: vi.fn()
}));
vi.mock("@/lib/localDb", () => ({ getInstanceById: mocks.getInstanceById, updateInstance: vi.fn() }));
vi.mock("@/lib/oauth/utils/pkce", () => ({ generatePKCE: vi.fn() }));
vi.mock("@/lib/oauth/utils/server", () => ({
  registerMcpSession: vi.fn(), getMcpSessionStatus: mocks.getMcpSessionStatus,
  completeMcpSession: mocks.completeMcpSession, clearMcpSession: mocks.clearMcpSession
}));
vi.mock("@/lib/mcp/gateway/oauthDiscovery", () => ({ discoverAuth: vi.fn() }));
vi.mock("@/lib/mcp/gateway/oauthRegister", () => ({ registerClient: vi.fn() }));
vi.mock("@/lib/mcp/gateway/oauthRefresh", () => ({ storeTokens: mocks.storeTokens }));
vi.mock("@/lib/mcp/gateway/oauthCimd", () => ({
  cimdClientId: vi.fn(), buildClientMetadataDocument: vi.fn(), isPubliclyFetchableBase: vi.fn()
}));

import { GET } from "../../src/app/api/mcp-gateway/oauth/[id]/[action]/route.js";

const context = { params: Promise.resolve({ id: "test", action: "callback" }) };
const csp = "default-src 'none'; style-src 'unsafe-inline'";
const callback = (query) => GET(new Request(`https://example.test/callback?${query}`), context);

afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });

describe("MCP OAuth callback result page", () => {
  it("does not reflect provider error markup and applies CSP", async () => {
    const response = await callback(new URLSearchParams({ error: '<script>alert("x")</script>' }));
    const html = await response.text();
    expect(html).toContain("OAuth authorization failed.");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert");
    expect(response.headers.get("content-security-policy")).toBe(csp);
  });

  it("escapes exception text in the result page", async () => {
    vi.useFakeTimers();
    mocks.getInstanceById.mockResolvedValue({ id: "test", oauthTokens: { as: { token_endpoint: "https://example.test/token" } } });
    mocks.getMcpSessionStatus.mockReturnValue({ codeVerifier: "v", clientId: "c", redirectUri: "https://example.test/callback" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`<img src="x" onerror='alert(1)'>&`));
    const response = await callback("code=c&state=s");
    const html = await response.text();
    expect(html).toContain("&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;");
    expect(html).not.toContain("<img");
    expect(response.headers.get("content-security-policy")).toBe(csp);
  });

  it("preserves the success message and applies CSP", async () => {
    vi.useFakeTimers();
    mocks.getInstanceById.mockResolvedValue({ id: "test", oauthTokens: { as: { token_endpoint: "https://example.test/token" } } });
    mocks.getMcpSessionStatus.mockReturnValue({ codeVerifier: "v", clientId: "c", redirectUri: "https://example.test/callback" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"access_token":"token"}'));
    const response = await callback("code=c&state=s");
    expect(await response.text()).toContain("<h1>Authentication Successful</h1><p>Connected. You can close this tab.</p>");
    expect(response.headers.get("content-security-policy")).toBe(csp);
  });
});
