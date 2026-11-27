import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("open", () => ({ default: vi.fn() }));

import { XaiService } from "../../src/lib/oauth/services/xai.js";
import { XAI_CONFIG } from "../../src/lib/oauth/constants/xai.js";

afterEach(() => vi.unstubAllGlobals());

describe("xAI CLI authorization code service", () => {
  it("builds an authorization URL with state and PKCE", () => {
    const service = new XaiService();
    const url = new URL(service.buildXaiAuthUrl("http://127.0.0.1:56121/callback", "state-a", "challenge-a", XAI_CONFIG.authorizeUrl));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: XAI_CONFIG.clientId, state: "state-a", code_challenge: "challenge-a",
      code_challenge_method: "S256", scope: XAI_CONFIG.scope,
    });
  });

  it("keeps concurrent code exchanges and proxy selection separate", async () => {
    const fetchMock = vi.fn(async (_url, options) => new Response(JSON.stringify({ access_token: options.body.get("code") }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new XaiService();
    const makeRequest = (code, proxyOptions) => service.exchangeXaiCode({ tokenUrl: XAI_CONFIG.tokenUrl, code, redirectUri: XAI_CONFIG.redirectUri, codeVerifier: `verifier-${code}`, proxyOptions });
    const proxyA = { proxyUrl: "http://proxy-a" };
    const proxyB = { proxyUrl: "http://proxy-b" };
    const [a, b] = await Promise.all([makeRequest("code-a", proxyA), makeRequest("code-b", proxyB)]);
    expect([a.access_token, b.access_token]).toEqual(["code-a", "code-b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, options]) => [options.body.get("code_verifier"), options.proxyOptions])).toEqual([["verifier-code-a", proxyA], ["verifier-code-b", proxyB]]);
  });

  it("does not expose a rejected exchange response body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("synthetic-secret", { status: 401 })));
    await expect(new XaiService().exchangeXaiCode({ tokenUrl: XAI_CONFIG.tokenUrl, code: "code", redirectUri: XAI_CONFIG.redirectUri, codeVerifier: "verifier" })).rejects.toThrow("xAI token exchange failed (HTTP 401)");
  });
});

describe("production Grok device provider", () => {
  it("requests a device code and polls with the selected proxy", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");
    const provider = getProvider("grok-cli");
    const proxy = { proxyUrl: "http://proxy-a" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ device_code: "device-a", user_code: "AB-CD", verification_uri: "https://auth.x.ai/activate" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-a", refresh_token: "refresh-a" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const device = await provider.requestDeviceCode(provider.config, null, null, proxy);
    expect(device.device_code).toBe("device-a");
    expect((await provider.pollToken(provider.config, device.device_code, null, null, proxy)).data.error).toBe("authorization_pending");
    expect((await provider.pollToken(provider.config, device.device_code, null, null, proxy)).data.access_token).toBe("token-a");
    expect(fetchMock.mock.calls).toHaveLength(3);
    expect(fetchMock.mock.calls.every(([, options]) => options.proxyOptions === proxy)).toBe(true);
    expect(fetchMock.mock.calls[1][1].body.get("device_code")).toBe("device-a");
  });

  it("returns denied and expired responses without treating them as pending", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");
    const provider = getProvider("grok-cli");
    for (const error of ["access_denied", "expired_token"]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error }), { status: 400 })));
      expect(await provider.pollToken(provider.config, "device-a")).toMatchObject({ ok: false, data: { error } });
    }
  });
});

describe("staged Grok browser and import registration", () => {
  it("uses the distinct callback, PKCE and scope", async () => {
    const { buildGrokBrowserAuthUrl, GROK_BROWSER_REDIRECT_URI, GROK_BROWSER_SCOPE } = await import("../../src/lib/oauth/providerParity/xai-grok-cli/index.js");
    const url = new URL(buildGrokBrowserAuthUrl(XAI_CONFIG, GROK_BROWSER_REDIRECT_URI, "state-a", "challenge-a"));
    expect(url.searchParams.get("scope")).toBe(GROK_BROWSER_SCOPE);
    expect(url.searchParams.get("redirect_uri")).toBe(GROK_BROWSER_REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe("state-a");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-a");
  });

  it("preserves the explicitly selected account without storing other entries", async () => {
    const { mapGrokImportedToken } = await import("../../src/lib/oauth/providerParity/xai-grok-cli/index.js");
    const jwt = (email) => `header.${Buffer.from(JSON.stringify({ email, exp: 1 })).toString("base64url")}.signature`;
    const input = { first: { key: jwt("a@example.test"), refresh_token: "refresh-a" }, second: { key: jwt("b@example.test"), refresh_token: "refresh-b" } };
    expect(() => mapGrokImportedToken(input)).toThrow("Select a Grok account");
    const mapped = mapGrokImportedToken(input, "second", 5000);
    expect(mapped).toMatchObject({ accessToken: input.second.key, refreshToken: "refresh-b", email: "b@example.test", expiresIn: 1 });
    expect(JSON.stringify(mapped)).not.toContain("refresh-a");
  });

  it("rejects invalid exchanges before network and suppresses upstream error bodies", async () => {
    const { exchangeGrokBrowserCode, GROK_BROWSER_REDIRECT_URI } = await import("../../src/lib/oauth/providerParity/xai-grok-cli/index.js");
    const mock = vi.fn(async () => new Response("secret-upstream-body", { status: 401 }));
    vi.stubGlobal("fetch", mock);
    await expect(exchangeGrokBrowserCode(XAI_CONFIG, "code", "https://attacker.test", "verifier")).rejects.toThrow("Invalid Grok browser exchange parameters");
    expect(mock).not.toHaveBeenCalled();
    await expect(exchangeGrokBrowserCode(XAI_CONFIG, "code", GROK_BROWSER_REDIRECT_URI, "verifier")).rejects.toThrow("HTTP 401");
  });
});

describe("xAI CLI discovery and refresh", () => {
  it("retries failed discovery, caches successful discovery by proxy, and refreshes with its own token", async () => {
    const { discoverEndpoints } = await import("../../src/lib/oauth/services/xai.js");
    const proxyA = { proxyUrl: "http://proxy-a" };
    const proxyB = { proxyUrl: "http://proxy-b" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorization_endpoint: "https://auth.x.ai/a", token_endpoint: "https://auth.x.ai/t" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorization_endpoint: "https://auth.x.ai/b", token_endpoint: "https://auth.x.ai/u" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-a", refresh_token: "rotated-a" })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await discoverEndpoints(proxyA)).tokenUrl).toBe(XAI_CONFIG.tokenUrl);
    expect((await discoverEndpoints(proxyA)).tokenUrl).toBe("https://auth.x.ai/t");
    expect((await discoverEndpoints(proxyA)).tokenUrl).toBe("https://auth.x.ai/t");
    expect((await discoverEndpoints(proxyB)).tokenUrl).toBe("https://auth.x.ai/u");
    expect(await new XaiService().refreshAccessToken("refresh-a", proxyA)).toMatchObject({ access_token: "new-a", refresh_token: "rotated-a" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][1].body.get("refresh_token")).toBe("refresh-a");
    expect(fetchMock.mock.calls[3][1].proxyOptions).toBe(proxyA);
  });
});
