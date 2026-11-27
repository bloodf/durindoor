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

  // The CLI exchange keeps the upstream reason because tests/unit/oauth-callback-cleanup.test.js:117
  // pins "xAI token exchange failed: exchange rejected"; credential shapes are still redacted.
  it("redacts credentials from a rejected CLI exchange reason", async () => {
    const leaked = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`rejected Bearer synthetic-bearer ${leaked}`, { status: 401 })));
    const error = await new XaiService().exchangeXaiCode({ tokenUrl: XAI_CONFIG.tokenUrl, code: "code", redirectUri: XAI_CONFIG.redirectUri, codeVerifier: "verifier" }).catch((e) => e);
    expect(error.message).toMatch(/^xAI token exchange failed: rejected /);
    expect(error.message).not.toContain("synthetic-bearer");
    expect(error.message).not.toContain(leaked);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(new XaiService().exchangeXaiCode({ tokenUrl: XAI_CONFIG.tokenUrl, code: "code", redirectUri: XAI_CONFIG.redirectUri, codeVerifier: "verifier" })).rejects.toThrow(/^xAI token exchange failed: HTTP 503$/);
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

// ---------------------------------------------------------------------------
// Contracts added after source comparison with CLIProxyAPI dbe641f, OmniRoute
// b15b2ee6 and EasyCLIProxyAPI 29567ead. Synthetic tokens only.
// ---------------------------------------------------------------------------
const parity = () => import("../../src/lib/oauth/providerParity/xai-grok-cli/index.js");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const routeFetch = (routes) => vi.fn(async (url, options) => {
  for (const [match, handler] of routes) if (String(url).includes(match)) return handler(url, options);
  throw new Error(`unexpected request ${url}`);
});
const fakeClock = () => {
  let t = 1_000_000;
  const sleeps = [];
  return { now: () => t, sleeps, sleep: vi.fn(async (ms) => { sleeps.push(ms); t += ms; }) };
};

describe("xAI CLI refresh and rejected tokens", () => {
  it("keeps the OAuth error code for invalid_grant routing without the description", async () => {
    vi.stubGlobal("fetch", routeFetch([
      ["openid-configuration", () => new Response("down", { status: 503 })],
      ["/oauth2/token", () => json({ error: "invalid_grant", error_description: "synthetic-secret-detail" }, 400)],
    ]));
    const error = await new XaiService().refreshAccessToken("refresh-revoked-1").catch((e) => e);
    expect(error.message).toBe("xAI token refresh failed (HTTP 400): invalid_grant");
    expect(error.message).not.toContain("synthetic-secret-detail");

    const { refreshXaiToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
    const log = { warn: vi.fn() };
    expect(await refreshXaiToken("refresh-revoked-2", log)).toEqual({ error: "invalid_grant" });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("synthetic-secret-detail");
  });

  it("treats non-JSON rejections as status-only and transient refresh failures as retryable", async () => {
    vi.stubGlobal("fetch", routeFetch([
      ["openid-configuration", () => new Response("down", { status: 503 })],
      ["/oauth2/token", () => new Response("<html>synthetic-upstream-body</html>", { status: 502 })],
    ]));
    await expect(new XaiService().refreshAccessToken("refresh-502")).rejects.toThrow(/^xAI token refresh failed \(HTTP 502\)$/);
    const { refreshXaiToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
    expect(await refreshXaiToken("refresh-502-b", null)).toBeNull();
  });

  it("rejects token responses without an access token", async () => {
    vi.stubGlobal("fetch", routeFetch([
      ["openid-configuration", () => new Response("down", { status: 503 })],
      ["/oauth2/token", () => json({ refresh_token: "r" })],
    ]));
    await expect(new XaiService().refreshAccessToken("refresh-empty")).rejects.toThrow("missing access_token");
  });
});

describe("staged xAI web discovery and exchange", () => {
  it("does not cache fallback, caches per proxy, and never adopts non-x.ai endpoints", async () => {
    const { discoverXaiWebEndpoints, resetXaiWebDiscoveryCache } = await parity();
    resetXaiWebDiscoveryCache();
    const responses = [
      new Response("down", { status: 503 }),
      json({ authorization_endpoint: "https://evil.example/a", token_endpoint: "https://evil.example/t" }),
      json({ authorization_endpoint: "https://auth.x.ai/a2", token_endpoint: "https://auth.x.ai/t2" }),
      json({ authorization_endpoint: "https://auth.x.ai/a3", token_endpoint: "https://auth.x.ai/t3" }),
    ];
    const fetchMock = vi.fn(async () => responses.shift());
    vi.stubGlobal("fetch", fetchMock);
    const proxy = { proxyUrl: "http://proxy-a" };
    expect(await discoverXaiWebEndpoints()).toEqual({ authorizeUrl: XAI_CONFIG.authorizeUrl, tokenUrl: XAI_CONFIG.tokenUrl });
    expect((await discoverXaiWebEndpoints()).tokenUrl).toBe(XAI_CONFIG.tokenUrl);
    expect((await discoverXaiWebEndpoints()).tokenUrl).toBe("https://auth.x.ai/t2");
    expect((await discoverXaiWebEndpoints()).tokenUrl).toBe("https://auth.x.ai/t2");
    expect((await discoverXaiWebEndpoints(proxy)).tokenUrl).toBe("https://auth.x.ai/t3");
    expect((await discoverXaiWebEndpoints(proxy)).tokenUrl).toBe("https://auth.x.ai/t3");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][1].proxyOptions).toBe(proxy);
  });

  it("fails invalid exchanges before network and reports only status and OAuth code", async () => {
    const { exchangeXaiWebCode } = await parity();
    const fetchMock = vi.fn(async () => json({ error: "invalid_grant", error_description: "synthetic-secret" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    await expect(exchangeXaiWebCode(XAI_CONFIG, "", XAI_CONFIG.redirectUri, "v")).rejects.toThrow("Invalid xAI exchange parameters");
    expect(fetchMock).not.toHaveBeenCalled();
    const error = await exchangeXaiWebCode(XAI_CONFIG, "code", XAI_CONFIG.redirectUri, "v").catch((e) => e);
    expect(error.message).toBe("xAI token exchange failed (HTTP 400): invalid_grant");
    expect(fetchMock.mock.calls[0][1].body.get("code_verifier")).toBe("v");
  });
});

describe("Grok CLI device polling lifecycle over the production transport", () => {
  const providerPoll = async (proxyOptions) => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");
    const provider = getProvider("grok-cli");
    return (code) => provider.pollToken(provider.config, code, null, null, proxyOptions);
  };

  it("polls immediately, honours slow_down, and stops after the accepted token", async () => {
    const { pollGrokDeviceAuthorization } = await parity();
    const replies = [json({ error: "authorization_pending" }, 400), json({ error: "slow_down" }, 400), json({ access_token: "token-a", refresh_token: "refresh-a" }), json({ access_token: "never" })];
    const fetchMock = vi.fn(async () => replies.shift());
    vi.stubGlobal("fetch", fetchMock);
    const clock = fakeClock();
    const proxy = { proxyUrl: "http://proxy-a" };
    const tokens = await pollGrokDeviceAuthorization({ poll: await providerPoll(proxy), deviceCode: "device-a", interval: 1, expiresIn: 600, ...clock });
    expect(tokens.access_token).toBe("token-a");
    expect(clock.sleeps).toEqual([5000, 10000]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, o]) => o.proxyOptions === proxy && o.body.get("device_code") === "device-a")).toBe(true);
  });

  it("stops at expires_in and at the 30 minute ceiling", async () => {
    const { pollGrokDeviceAuthorization, GROK_MAX_POLL_DURATION_MS } = await parity();
    const fetchMock = vi.fn(async () => json({ error: "authorization_pending" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    const short = fakeClock();
    await expect(pollGrokDeviceAuthorization({ poll: await providerPoll(null), deviceCode: "d", interval: 5, expiresIn: 12, ...short })).rejects.toThrow("Grok device code expired");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockClear();
    const long = fakeClock();
    await expect(pollGrokDeviceAuthorization({ poll: await providerPoll(null), deviceCode: "d", interval: 60, ...long })).rejects.toThrow("expired");
    expect(fetchMock).toHaveBeenCalledTimes(GROK_MAX_POLL_DURATION_MS / 60000 + 1);
  });

  it("aborts during a wait without another request", async () => {
    const { pollGrokDeviceAuthorization } = await parity();
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => json({ error: "authorization_pending" }, 400));
      vi.stubGlobal("fetch", fetchMock);
      const controller = new AbortController();
      const run = pollGrokDeviceAuthorization({ poll: await providerPoll(null), deviceCode: "d", interval: 5, signal: controller.signal });
      const settled = run.catch((e) => e);
      await vi.advanceTimersByTimeAsync(4000);
      controller.abort();
      const error = await settled;
      expect(error.name).toBe("AbortError");
      await vi.advanceTimersByTimeAsync(60000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["access_denied", "Grok device authorization denied"],
    ["expired_token", "Grok device code expired"],
    ["server_error", "Grok device authorization failed: server_error"],
  ])("ends on %s without leaking the description", async (code, message) => {
    const { pollGrokDeviceAuthorization } = await parity();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: code, error_description: "synthetic-secret" }, 400)));
    const error = await pollGrokDeviceAuthorization({ poll: await providerPoll(null), deviceCode: "d", ...fakeClock() }).catch((e) => e);
    expect(error.message).toBe(message);
  });

  it("keeps two concurrent accounts on their own device code, proxy and token", async () => {
    const { pollGrokDeviceAuthorization } = await parity();
    const seen = { "device-a": 0, "device-b": 0 };
    const fetchMock = vi.fn(async (_url, options) => {
      const code = options.body.get("device_code");
      seen[code] += 1;
      return seen[code] === 1 ? json({ error: "authorization_pending" }, 400) : json({ access_token: `token-for-${code}` });
    });
    vi.stubGlobal("fetch", fetchMock);
    const proxyA = { proxyUrl: "http://proxy-a" };
    const proxyB = { proxyUrl: "http://proxy-b" };
    const [a, b] = await Promise.all([
      pollGrokDeviceAuthorization({ poll: await providerPoll(proxyA), deviceCode: "device-a", ...fakeClock() }),
      pollGrokDeviceAuthorization({ poll: await providerPoll(proxyB), deviceCode: "device-b", ...fakeClock() }),
    ]);
    expect([a.access_token, b.access_token]).toEqual(["token-for-device-a", "token-for-device-b"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.proxyOptions).toBe(options.body.get("device_code") === "device-a" ? proxyA : proxyB);
    }
  });

  it("rejects unsupported modes and malformed polls before network", async () => {
    const { assertGrokSignInMode, pollGrokDeviceAuthorization } = await parity();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(() => assertGrokSignInMode("password")).toThrow("Unsupported Grok sign-in mode");
    expect(assertGrokSignInMode("device")).toBe("device");
    await expect(pollGrokDeviceAuthorization({ poll: await providerPoll(null), deviceCode: "" })).rejects.toThrow("Invalid Grok device authorization");
    const aborted = AbortSignal.abort();
    await expect(pollGrokDeviceAuthorization({ poll: await providerPoll(null), deviceCode: "d", signal: aborted })).rejects.toThrow("aborted");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Grok auth.json paste and selected account import", () => {
  const jwt = (claims) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

  it("rejects a bare JWT, malformed JSON and entries without refresh tokens", async () => {
    const { parseGrokAuthJsonPaste } = await parity();
    expect(() => parseGrokAuthJsonPaste(jwt({ email: "a@example.test" }))).toThrow("full ~/.grok/auth.json");
    expect(() => parseGrokAuthJsonPaste("{oops")).toThrow("Could not parse");
    expect(() => parseGrokAuthJsonPaste("[]")).toThrow();
    expect(() => parseGrokAuthJsonPaste(JSON.stringify({ a: { key: jwt({}) } }))).toThrow("missing refresh_token");
  });

  it("lists selectable accounts without tokens and imports only the chosen one, expired tokens stay refreshable", async () => {
    const { parseGrokAuthJsonPaste, mapGrokImportedToken } = await parity();
    const raw = JSON.stringify({
      "https://auth.x.ai::client": { key: jwt({ email: "a@example.test", exp: 10 }), refresh_token: "refresh-a" },
      other: { key: jwt({ email: "b@example.test", exp: 10 }), refresh_token: "refresh-b" },
      noise: { key: "not-a-jwt" },
    });
    const { doc, accounts } = parseGrokAuthJsonPaste(raw);
    expect(accounts).toEqual(["https://auth.x.ai::client", "other"]);
    const mapped = mapGrokImportedToken(doc, "other", 3_600_000);
    expect(mapped).toMatchObject({ refreshToken: "refresh-b", email: "b@example.test", expiresIn: 1, providerSpecificData: { sourceAccount: "other" } });
    expect(JSON.stringify(mapped)).not.toContain("refresh-a");
  });
});

describe("Grok CLI and xAI request identities", () => {
  it("keeps per-account bearer, email and agent id with a server-accepted client version", async () => {
    const { GrokCliExecutor } = await import("../../open-sse/executors/grok-cli.js");
    const { GROK_CLI_VERSION } = await import("../../open-sse/config/grokCli.js");
    const executor = new GrokCliExecutor();
    const a = executor.buildHeaders({ accessToken: "tok-a", providerSpecificData: { email: "a@example.test", deviceId: "agent-a" } }, true, null, "grok-4.7");
    const b = executor.buildHeaders({ accessToken: "tok-b", providerSpecificData: { email: "b@example.test", deviceId: "agent-b" } }, true, null, "grok-build");
    expect([a.Authorization, a["x-email"], a["x-grok-agent-id"]]).toEqual(["Bearer tok-a", "a@example.test", "agent-a"]);
    expect([b.Authorization, b["x-email"], b["x-grok-agent-id"]]).toEqual(["Bearer tok-b", "b@example.test", "agent-b"]);
    expect(a["x-xai-token-auth"]).toBe("xai-grok-cli");
    // grok-build sends the grok-shell fingerprint, which omits x-xai-token-auth.
    expect(b["x-xai-token-auth"]).toBeUndefined();
    for (const h of [a, b]) expect(h["x-grok-client-version"]).toBe(GROK_CLI_VERSION);
    // CLIProxyAPI helps/xai_version.go: cli-chat-proxy rejects clients below 1.0.13 with HTTP 426.
    const [maj, min, patch] = GROK_CLI_VERSION.split(".").map(Number);
    expect(maj > 1 || (maj === 1 && (min > 0 || patch >= 13))).toBe(true);
  });

  it("keeps xAI API requests free of Grok CLI service identity headers", async () => {
    const { XaiExecutor } = await import("../../open-sse/executors/xai.js");
    const headers = new XaiExecutor().buildHeaders({ accessToken: "tok-x" }, true);
    expect(headers.Authorization).toBe("Bearer tok-x");
    expect(Object.keys(headers).filter((k) => /^x-(grok|xai)-/i.test(k))).toEqual([]);
  });
});

// Staging-only block: flip to positive registration assertions when the auth batch wires these helpers.
describe("staged xai-grok-cli registration (not active in production)", () => {
  it("lists only real exports and production still exposes device-only grok-cli", async () => {
    const { readFileSync } = await import("node:fs");
    const registration = JSON.parse(readFileSync(new URL("../../src/lib/oauth/providerParity/xai-grok-cli/registration.json", import.meta.url), "utf8"));
    const mod = await parity();
    expect(registration.status).toBe("staged");
    expect(registration.exports.filter((name) => !(name in mod))).toEqual([]);
    const { getProvider } = await import("../../src/lib/oauth/providers.js");
    const grok = getProvider("grok-cli");
    expect(grok.flowType).toBe("device_code");
    expect(grok.buildAuthUrl).toBeUndefined();
  });
});
