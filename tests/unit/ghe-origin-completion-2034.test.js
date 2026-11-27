import { afterEach, describe, expect, it, vi } from "vitest";
import provider from "../../src/lib/oauth/gheCopilotProvider.js";
import { GheCopilotExecutor } from "../../open-sse/executors/ghe-copilot.js";
import { gheRequestContext, refreshBoundGheCopilotCredentials } from "../../src/lib/oauth/providerParity/copilot/gheConnection.js";
import { __setOriginalFetchForTesting, __setProxyDispatcherForTesting, __clearProxyDispatchersForTesting } from "../../open-sse/utils/proxyFetch.js";

let restore;
const calls = [];
const proxies = ["a", "b"].map(id => ({ connectionProxyEnabled: true, connectionProxyUrl: `http://proxy-${id}.invalid:8080` }));
function network(handler) {
  calls.length = 0;
  proxies.forEach((proxy, i) => __setProxyDispatcherForTesting(proxy.connectionProxyUrl, { tenant: i }));
  restore = __setOriginalFetchForTesting(async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  });
}
afterEach(() => { restore?.(); restore = null; __clearProxyDispatchersForTesting(); vi.restoreAllMocks(); });
const auth = init => new Headers(init.headers).get("authorization");
async function signIn(i = 0, issuer = `https://tenant-${i}.example.test`) {
  const config = { clientId: `client-${i}`, scopes: "read:user" };
  const started = await provider.requestDeviceCode(config, null, { gheUrl: issuer }, proxies[i]);
  const poll = await provider.pollToken(config, started.device_code, null, started, proxies[i]);
  return provider.mapTokens(poll.data, await provider.postExchange(poll.data, proxies[i], started));
}
function loginTransport(url, init) {
  const i = init.dispatcher?.tenant ?? 0;
  if (url.endsWith("/login/device/code")) return Response.json({ device_code: `device-${i}` });
  if (url.endsWith("/login/oauth/access_token")) return Response.json({ access_token: `oauth-${i}`, refresh_token: `refresh-${i}` });
  if (url.endsWith("/api/v3/user")) return Response.json({ login: `tenant-${i}` });
  if (url.endsWith("/api/v3/copilot_internal/v2/token")) return Response.json({ token: `session-${i}`, expires_at: 4102444800, endpoints: { api: "https://api.enterprise.githubcopilot.com" } });
  return Response.json({ id: "answer", choices: [], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
}
const request = (credentials, i = 0, extra = {}) => new GheCopilotExecutor().execute({ model: "gpt-4.1", stream: false, body: { messages: [{ role: "user", content: "hello" }] }, credentials, proxyOptions: proxies[i], ...extra });

describe("GHE source-supported credential boundaries", () => {
  it("signs in two issuers/clients/proxies and sends only session credentials to the proven different-domain peer", async () => {
    network(loginTransport);
    const rows = await Promise.all([signIn(0), signIn(1)]);
    for (let i = 0; i < 2; i++) {
      expect(rows[i].providerSpecificData.gheBinding).toEqual({ issuer: `https://tenant-${i}.example.test`, clientId: `client-${i}`, proxyOptions: proxies[i] });
      const bypass = vi.fn();
      const result = await request(rows[i], i, { directFetch: bypass });
      expect(bypass).not.toHaveBeenCalled();
      expect((await result.response.json()).usage.total_tokens).toBe(5);
    }
    const inference = calls.filter(call => call.url.endsWith("/chat/completions"));
    expect(inference).toHaveLength(2);
    inference.forEach(({ url, init }, i) => {
      expect(url).toBe("https://api.enterprise.githubcopilot.com/chat/completions");
      expect(auth(init)).toBe(`Bearer session-${i}`);
      expect(init.dispatcher.tenant).toBe(i);
      expect(init.redirect).toBe("error");
    });
  });

  it.each(["https://collector.invalid", "https://api.enterprise.githubcopilot.com.evil.invalid", "https://tenant-0.example.test:8443", "https://169.254.169.254", "https://githubusercontent.com", "https://tenant-0.example.test/path", "https://user:pw@tenant-0.example.test"])("refuses forged API metadata %s before inference", async api => {
    network(loginTransport);
    const row = await signIn();
    row.providerSpecificData.copilotApiUrl = api;
    const before = calls.length;
    await expect(request(row)).rejects.toThrow(/untrusted|provenance/);
    expect(calls).toHaveLength(before);
  });

  it("refuses a changed client, issuer, proxy or session token without dispatch", async () => {
    network(loginTransport);
    const row = await signIn();
    const before = calls.length;
    for (const field of ["clientId", "issuer"]) {
      const changed = structuredClone(row);
      changed.providerSpecificData.gheBinding[field] = field === "issuer" ? "https://other.invalid" : "other-client";
      await expect(request(changed)).rejects.toThrow(/reauthentication/);
    }
    await expect(request(row, 1)).rejects.toThrow(/proxy/);
    await expect(request({ ...row, copilotToken: "another-session" })).rejects.toThrow(/provenance/);
    expect(calls).toHaveLength(before);
  });

  it("never falls back to the long-lived OAuth credential for inference", async () => {
    network(loginTransport);
    const row = await signIn();
    delete row.providerSpecificData.copilotToken;
    const before = calls.length;
    await expect(request(row)).rejects.toThrow(/session credential/);
    expect(calls).toHaveLength(before);
  });

  it.each([1, "4102444800"])("rejects a stated expired or malformed sign-in session expiry (%s)", async expires_at => {
    network((url, init) => url.endsWith("/copilot_internal/v2/token")
      ? Response.json({ token: "session-0", expires_at, endpoints: { api: "https://api.enterprise.githubcopilot.com" } }) : loginTransport(url, init));
    await expect(signIn()).rejects.toMatchObject({ code: "reauthentication_needed" });
    expect(calls.every(call => !call.url.includes("githubcopilot.com"))).toBe(true);
  });

  it("accepts a historical exchange without expiry and still dispatches only the session token", async () => {
    network((url, init) => url.endsWith("/copilot_internal/v2/token")
      ? Response.json({ token: "session-0", endpoints: { api: "https://api.enterprise.githubcopilot.com" } }) : loginTransport(url, init));
    const row = await signIn();
    expect(row.providerSpecificData.copilotTokenExpiresAt).toBeUndefined();
    await request(row);
    expect(calls.at(-1).url).toBe("https://api.enterprise.githubcopilot.com/chat/completions");
    expect(auth(calls.at(-1).init)).toBe("Bearer session-0");
  });

  it("dispatches a bound row without a stated API to its issuer, never to forged metadata", async () => {
    network((url, init) => url.endsWith("/copilot_internal/v2/token")
      ? Response.json({ token: "session-0", expires_at: 4102444800, endpoints: { api: "https://collector.invalid" } }) : loginTransport(url, init));
    const row = await signIn();
    expect(row.providerSpecificData.copilotApiUrl).toBeUndefined();
    await request(row);
    expect(calls.at(-1).url).toBe("https://tenant-0.example.test/chat/completions");
    expect(auth(calls.at(-1).init)).toBe("Bearer session-0");
  });

  it("rejects OAuth masquerading as a scoped exchange token", async () => {
    network((url, init) => url.endsWith("/copilot_internal/v2/token")
      ? Response.json({ token: "oauth-0", expires_at: 4102444800, endpoints: { api: "https://api.enterprise.githubcopilot.com" } }) : loginTransport(url, init));
    await expect(signIn()).rejects.toMatchObject({ code: "oauth_forwarding_refused" });
    expect(calls.every(call => !call.url.includes("githubcopilot.com"))).toBe(true);
  });

  it("reads the GHE.com source fallback but refuses unsupported cross-origin OAuth forwarding precisely", async () => {
    network((url, init) => {
      if (url.endsWith("/copilot_internal/v2/token")) return new Response(null, { status: 404 });
      if (url.endsWith("/copilot_internal/user")) return Response.json({ endpoints: { api: "https://copilot-api.tenant.ghe.com" } });
      return loginTransport(url, init);
    });
    await expect(signIn(0, "https://tenant.ghe.com")).rejects.toMatchObject({ code: "unsupported_ghe_oauth_peer" });
    expect(calls.some(call => call.url.endsWith("/copilot_internal/user"))).toBe(true);
    expect(calls.every(call => new URL(call.url).origin === "https://tenant.ghe.com")).toBe(true);
  });

  it("supports GHE.com OAuth fallback only on the issuer itself", async () => {
    network((url, init) => {
      if (url.endsWith("/copilot_internal/v2/token")) return new Response(null, { status: 404 });
      if (url.endsWith("/copilot_internal/user")) return Response.json({ endpoints: { api: "https://tenant.ghe.com" } });
      return loginTransport(url, init);
    });
    const row = await signIn(0, "https://tenant.ghe.com");
    expect(row.providerSpecificData.gheSession.kind).toBe("issuer-oauth");
    await request(row);
    expect(calls.at(-1).url).toBe("https://tenant.ghe.com/chat/completions");
    expect(auth(calls.at(-1).init)).toBe("Bearer oauth-0");
  });

  it("refuses redirects from the actual request transport and does not follow them", async () => {
    network((url, init) => url.endsWith("/chat/completions") ? new Response(null, { status: 302, headers: { location: "https://collector.invalid" } }) : loginTransport(url, init));
    const row = await signIn();
    await expect(request(row)).rejects.toThrow(/redirect/);
    expect(calls.filter(call => call.url.endsWith("/chat/completions"))).toHaveLength(1);
    expect(calls.some(call => call.url.includes("collector.invalid"))).toBe(false);
  });

  it("permits a legacy session only with a historical issuer; refreshes only on that issuer with the configured client", async () => {
    network(loginTransport);
    const legacy = { accessToken: "oauth-old", refreshToken: "refresh-old", providerSpecificData: { gheUrl: "https://private.enterprise.test", copilotApiUrl: "https://api.enterprise.githubcopilot.com", copilotToken: "session-old", copilotTokenExpiresAt: 4102444800 } };
    const unchanged = structuredClone(legacy);
    await request(legacy);
    expect(auth(calls.at(-1).init)).toBe("Bearer session-old");
    restore();
    network((url, init) => auth(init) === "token oauth-old" ? new Response(null, { status: 401 }) : loginTransport(url, init));
    vi.stubEnv("GHE_COPILOT_OAUTH_CLIENT_ID", "configured-client");
    try {
      const next = await refreshBoundGheCopilotCredentials(legacy, null, proxies[0]);
      expect(next).toMatchObject({ accessToken: "oauth-0", copilotToken: "session-0" });
    } finally { vi.unstubAllEnvs(); }
    expect(calls.map(({ url }) => new URL(url).origin)).toEqual(Array(3).fill("https://private.enterprise.test"));
    expect(new URLSearchParams(calls[1].init.body).get("client_id")).toBe("configured-client");
    expect(legacy).toEqual(unchanged);
    for (const data of [{ copilotApiUrl: "https://api.enterprise.githubcopilot.com", copilotToken: "session-old" }, { ...legacy.providerSpecificData, copilotTokenExpiresAt: 1 }]) {
      expect(() => gheRequestContext({ ...legacy, providerSpecificData: data }, proxies[0])).toThrow(/reauthentication/);
    }
  });

  it("rotates refresh credentials with the stored client even if the process default changes", async () => {
    network(loginTransport);
    const row = await signIn();
    restore();
    network((url, init) => {
      if (url.endsWith("/login/oauth/access_token")) {
        expect(new URLSearchParams(init.body).get("client_id")).toBe("client-0");
        return Response.json({ access_token: "oauth-rotated", refresh_token: "refresh-rotated", expires_in: 3600 });
      }
      if (auth(init) === "token oauth-0") return new Response(null, { status: 401 });
      return Response.json({ token: "session-rotated", expires_at: 4102444800, endpoints: { api: "https://api.business.githubcopilot.com" } });
    });
    vi.stubEnv("GHE_COPILOT_OAUTH_CLIENT_ID", "wrong-process-client");
    try {
      const next = await refreshBoundGheCopilotCredentials(row, null, proxies[0]);
      expect(next.refreshToken).toBe("refresh-rotated");
      const merged = { ...row, ...next, providerSpecificData: { ...row.providerSpecificData, ...next.providerSpecificData } };
      expect(gheRequestContext(merged, proxies[0]).base).toBe("https://api.business.githubcopilot.com");
      expect(row.accessToken).toBe("oauth-0");
    } finally { vi.unstubAllEnvs(); }
  });
  it.each([["claude-sonnet-4.5", "/v1/messages"], ["gpt-6", "/responses"]])("guards the actual %s alternate request route", async (model, path) => {
    network((url, init) => url.endsWith(path) ? new Response(null, { status: 401 }) : loginTransport(url, init));
    const row = await signIn();
    const result = await request(row, 0, { model, stream: true });
    expect(result.response.status).toBe(401);
    expect(calls.at(-1).url).toBe(`https://api.enterprise.githubcopilot.com${path}`);
    expect(auth(calls.at(-1).init)).toBe("Bearer session-0");
  });

  it("keeps private enterprise APIs under the existing outbound policy", async () => {
    network((url, init) => url.endsWith("/copilot_internal/v2/token")
      ? Response.json({ token: "session-0", expires_at: 4102444800, endpoints: { api: "https://10.0.0.8" } }) : loginTransport(url, init));
    const row = await signIn(0, "https://10.0.0.8");
    await request(row);
    expect(calls.at(-1).url).toBe("https://10.0.0.8/chat/completions");
  });

  it("refuses unsupported enterprise credit lookup before consumer GitHub dispatch", async () => {
    network(loginTransport);
    const row = await signIn();
    row.providerSpecificData.aiCreditLimit = 10;
    const before = calls.length;
    await expect(request(row)).rejects.toMatchObject({ code: "unsupported_ghe_usage" });
    expect(calls).toHaveLength(before);
  });

});
