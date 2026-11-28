import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubService } from "../../src/lib/oauth/services/github.js";
import gheCopilot from "../../src/lib/oauth/gheCopilotProvider.js";

vi.mock("open", () => ({ default: vi.fn() }));

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Copilot sign-in boundaries", () => {
  it("refuses legacy API-only enterprise credentials before dispatch", async () => {
    const { GheCopilotExecutor } = await import("../../open-sse/executors/ghe-copilot.js");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(new GheCopilotExecutor().execute({
      model: "gpt-4o", body: { messages: [] }, stream: false,
      credentials: { accessToken: "long-lived-oauth", providerSpecificData: { copilotApiUrl: "https://operator.example.test" } }
    })).rejects.toThrow(/reauthentication needed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["getDeviceCode", "getCopilotToken", "getUserInfo"])("does not expose the %s upstream body", async (method) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("synthetic-secret", { status: 401 }));
    await expect(new GitHubService()[method]("synthetic-token")).rejects.toThrow(/HTTP 401/);
    try { await new GitHubService()[method]("synthetic-token"); } catch (error) {
      expect(error.message).not.toContain("synthetic-secret");
    }
  });

  it("keeps concurrent enterprise device requests bound to their hosts and proxies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      Response.json({ device_code: new URL(url).hostname }));
    const proxies = [{ id: "a" }, { id: "b" }];
    const results = await Promise.all(["a", "b"].map((id, i) =>
      gheCopilot.requestDeviceCode({ clientId: `client-${id}`, scopes: "read:user" }, null,
        { gheUrl: `https://${id}.example.test` }, proxies[i])));
    expect(results.map((result) => result._gheUrl)).toEqual(["https://a.example.test", "https://b.example.test"]);
    for (const [i, id] of ["a", "b"].entries()) {
      expect(fetchMock.mock.calls[i][1].proxyOptions).toBe(proxies[i]);
      expect(fetchMock.mock.calls[i][1].body.get("client_id")).toBe(`client-${id}`);
    }
  });

  it("rejects a non-HTTPS enterprise host before network access", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(gheCopilot.requestDeviceCode({}, null, { gheUrl: "http://example.test" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CLI device polling", () => {
  it("honors slow_down and stops after an accepted token", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const transport = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ error: "slow_down" }))
      .mockResolvedValueOnce(Response.json({ access_token: "synthetic-oauth", token_type: "bearer" }));
    const result = new GitHubService().pollAccessToken("device", "https://github.com/login/device", "code", 1000, 30);
    const assertion = expect(result).resolves.toMatchObject({ access_token: "synthetic-oauth" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
    await vi.advanceTimersByTimeAsync(20000);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("expires before a poll would occur after the deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const transport = vi.spyOn(globalThis, "fetch");
    await expect(new GitHubService().pollAccessToken("device", "https://github.com/login/device", "code", 1000, 1)).rejects.toThrow("Device code expired");
    expect(transport).not.toHaveBeenCalled();
  });

  it("can abort while waiting without submitting", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const transport = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();
    const result = new GitHubService().pollAccessToken("device", "https://github.com/login/device", "code", 1000, 30, controller.signal);
    const assertion = expect(result).rejects.toThrow("cancelled");
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("enterprise poll transport", () => {
  it("does not follow redirects or return malformed upstream bodies", async () => {
    const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("synthetic-secret", { status: 302, headers: { location: "https://other.example.test" } }));
    const result = await gheCopilot.pollToken({ clientId: "synthetic-client" }, "device", null, { _gheUrl: "https://tenant.example.test" }, { id: "proxy" });
    expect(result).toEqual({ ok: false, data: { error: "invalid_response" } });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]).toMatchObject({ redirect: "manual", proxyOptions: { id: "proxy" } });
  });
});

describe("staged web decoder", () => {
  it("retains device state while suppressing unknown upstream text", async () => {
    const { decodeCopilotPollResponse } = await import("../../src/lib/oauth/providerParity/copilot/index.js");
    expect(decodeCopilotPollResponse('{"error":"slow_down","error_description":"synthetic-secret"}')).toEqual({ error: "slow_down" });
    expect(decodeCopilotPollResponse("synthetic-secret")).toEqual({ error: "invalid_response" });
    expect(decodeCopilotPollResponse('{"access_token":"synthetic-token"}')).toEqual({ access_token: "synthetic-token" });
  });
});

describe("CLI device response", () => {
  it("rejects an untrusted browser URL before opening it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ device_code: "device", user_code: "code", verification_uri: "https://other.example.test/", expires_in: 300, interval: 5 }));
    await expect(new GitHubService().getDeviceCode()).rejects.toThrow("Invalid GitHub device response");
  });
});

// ---------------------------------------------------------------------------
// GHE connection binding: real adapter, helper, executor and proxy transport;
// only the bottom network transport and the proxy dispatchers are fixtures.
// ---------------------------------------------------------------------------
const proxyFetchModule = await import("../../open-sse/utils/proxyFetch.js");
const ghe = await import("../../src/lib/oauth/providerParity/copilot/gheConnection.js");
const { GheCopilotExecutor } = await import("../../open-sse/executors/ghe-copilot.js");
const { PROVIDERS } = await import("../../open-sse/config/providers.js");

const TENANTS = ["alpha", "beta"];
const origin = (tenant) => `https://${tenant}.example.test`;
const proxyFor = (tenant) => ({ connectionProxyEnabled: true, connectionProxyUrl: `http://proxy-${tenant}.invalid:8080` });

function installTransport(handler) {
  const calls = [];
  const dispatchers = Object.fromEntries(TENANTS.map((tenant) => [tenant, { tenant }]));
  for (const tenant of TENANTS) proxyFetchModule.__setProxyDispatcherForTesting(proxyFor(tenant).connectionProxyUrl, dispatchers[tenant]);
  const restore = proxyFetchModule.__setOriginalFetchForTesting(async (url, init = {}) => {
    const call = { url: String(url), init, proxy: init.dispatcher?.tenant ?? null };
    calls.push(call);
    return handler(call);
  });
  return { calls, restore };
}

const headerOf = (init, name) => new Headers(init.headers).get(name);
const tenantOf = (url) => new URL(url).hostname.split(".").at(-3);

describe("GHE connection binding", () => {
  let network;
  afterEach(() => {
    network?.restore();
    network = null;
    proxyFetchModule.__clearProxyDispatchersForTesting();
  });

  it("keeps two concurrent enterprise sign-ins on their own origin, client, proxy and endpoints", async () => {
    network = installTransport(async ({ url, init }) => {
      const tenant = tenantOf(url);
      const path = new URL(url).pathname;
      if (path === "/login/device/code") return Response.json({ device_code: `device-${tenant}`, user_code: "CODE", verification_uri: `${origin(tenant)}/login/device`, expires_in: 900, interval: 5, extra: "dropped" });
      if (path === "/login/oauth/access_token") return Response.json({ access_token: `oauth-${tenant}`, refresh_token: `refresh-${tenant}` });
      if (path === "/api/v3/copilot_internal/v2/token") {
        expect(headerOf(init, "authorization")).toBe(`Bearer oauth-${tenant}`);
        const api = tenant === "alpha" ? "https://copilot-api.alpha.example.test" : "https://collector.attacker.test";
        return Response.json({ token: `session-${tenant}`, expires_at: 4102444800, endpoints: { api } });
      }
      if (path === "/api/v3/user") return Response.json({ id: tenant.length, login: tenant, site_admin: true });
      throw new Error(`unexpected ${url}`);
    });
    const signIn = async (tenant) => {
      const config = { clientId: `client-${tenant}`, scopes: "read:user" };
      const started = await gheCopilot.requestDeviceCode(config, null, { gheUrl: origin(tenant) }, proxyFor(tenant));
      const poll = await gheCopilot.pollToken(config, started.device_code, null, { _gheUrl: started._gheUrl }, proxyFor(tenant));
      const extra = await gheCopilot.postExchange(poll.data, proxyFor(tenant), { _gheUrl: started._gheUrl });
      return { started, tokens: gheCopilot.mapTokens(poll.data, extra) };
    };
    const [alpha, beta] = await Promise.all(TENANTS.map(signIn));

    expect(alpha.started).toEqual({ device_code: "device-alpha", user_code: "CODE", verification_uri: `${origin("alpha")}/login/device`, expires_in: 900, interval: 5, _gheUrl: origin("alpha") });
    expect(alpha.tokens.providerSpecificData).toMatchObject({ gheUrl: origin("alpha"), copilotToken: "session-alpha", copilotApiUrl: "https://copilot-api.alpha.example.test", githubLogin: "alpha" });
    expect(beta.tokens.providerSpecificData).toMatchObject({ gheUrl: origin("beta"), copilotToken: "session-beta", copilotApiUrl: undefined, githubLogin: "beta" });
    expect(network.calls).toHaveLength(8);
    for (const { url, init, proxy } of network.calls) {
      const tenant = tenantOf(url);
      expect(new URL(url).origin).toBe(origin(tenant));
      expect(proxy).toBe(tenant);
      expect(init.redirect).toBe("manual");
      if (init.body) expect(new URLSearchParams(init.body).get("client_id")).toBe(`client-${tenant}`);
    }
  });

  it("refuses an enterprise redirect without following it", async () => {
    network = installTransport(async () => new Response("synthetic-secret", { status: 307, headers: { location: "https://other.example.test/login/device/code" } }));
    const failure = gheCopilot.requestDeviceCode({ clientId: "client", scopes: "read:user" }, null, { gheUrl: origin("alpha") }, proxyFor("alpha"));
    await expect(failure).rejects.toMatchObject({ code: "redirect_refused" });
    await expect(failure).rejects.not.toThrow(/synthetic-secret/);
    expect(network.calls.map(({ url }) => url)).toEqual([`${origin("alpha")}/login/device/code`]);
  });

  it("refuses foreign, look-alike, port-shifted and metadata origins before network access", async () => {
    network = installTransport(async () => Response.json({}));
    const binding = ghe.bindGheConnection({ gheUrl: origin("alpha"), clientId: "client" });
    for (const url of ["https://beta.example.test/api/v3/user", "https://alpha.example.test.attacker.test/x", "https://copilot-api.alpha.example.test:8443/models", "http://alpha.example.test/x"]) {
      await expect(ghe.gheBoundFetch(binding, url, { headers: { Authorization: "Bearer synthetic" } })).rejects.toMatchObject({ code: "foreign_origin" });
    }
    await expect(ghe.gheBoundFetch(ghe.bindGheConnection({ gheUrl: "https://169.254.169.254" }), "https://169.254.169.254/api/v3/user")).rejects.toThrow(/metadata/i);
    expect(() => ghe.bindGheConnection({ gheUrl: "https://user:pw@alpha.example.test" })).toThrow(/https/);
    expect(network.calls).toHaveLength(0);
    expect(ghe.isTrustedGheEndpoint(binding, "https://copilot-api.alpha.example.test")).toBe(true);
    expect(ghe.isTrustedGheEndpoint(binding, "https://api.business.githubcopilot.com")).toBe(true);
    expect(ghe.isTrustedGheEndpoint(binding, "https://copilot-api.alpha.example.test/?x=1")).toBe(false);
  });

  it("cancels before submission and propagates an in-flight abort from refresh", async () => {
    let release;
    network = installTransport(({ init }) => new Promise((_resolve, reject) => {
      release = () => reject(init.signal.reason);
      init.signal.addEventListener("abort", release, { once: true });
    }));
    const binding = ghe.bindGheConnection({ gheUrl: origin("alpha"), clientId: "client" });
    const early = new AbortController();
    early.abort();
    await expect(ghe.gheBoundFetch(binding, `${origin("alpha")}/api/v3/user`, { signal: early.signal })).rejects.toThrow();
    expect(network.calls).toHaveLength(0);

    const controller = new AbortController();
    const pending = ghe.refreshBoundGheCopilotCredentials({ accessToken: "oauth", refreshToken: "refresh", providerSpecificData: { gheUrl: origin("alpha") } }, null, null, { signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(network.calls).toHaveLength(1));
    controller.abort();
    await assertion;
    expect(network.calls).toHaveLength(1);
  });

  it("rejects an expired session, refreshes the OAuth token once and keeps each account's proxy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const now = Date.now() / 1000;
    const log = { error: vi.fn(), warn: vi.fn() };
    network = installTransport(async ({ url, init }) => {
      const tenant = tenantOf(url);
      const auth = headerOf(init, "authorization");
      if (url.endsWith("/login/oauth/access_token")) {
        expect(new URLSearchParams(init.body).get("refresh_token")).toBe(`refresh-${tenant}`);
        return Response.json({ access_token: `oauth2-${tenant}`, expires_in: 28800 });
      }
      if (auth === `token oauth-${tenant}`) return Response.json({ token: "stale", expires_at: now - 1, endpoints: { api: "https://collector.attacker.test" } });
      if (auth === `token oauth2-${tenant}`) return Response.json({ token: `session2-${tenant}`, expires_at: now + 1800, endpoints: { api: `https://copilot-api.${tenant}.example.test`, proxy: "https://collector.attacker.test" } });
      return new Response("synthetic-secret", { status: 401 });
    });
    const results = await Promise.all(TENANTS.map((tenant) => ghe.refreshBoundGheCopilotCredentials({
      accessToken: `oauth-${tenant}`, refreshToken: `refresh-${tenant}`, providerSpecificData: { gheUrl: origin(tenant) }
    }, log, proxyFor(tenant))));
    TENANTS.forEach((tenant, i) => expect(results[i]).toEqual({
      accessToken: `oauth2-${tenant}`, refreshToken: `refresh-${tenant}`, expiresIn: 28800,
      copilotToken: `session2-${tenant}`, copilotTokenExpiresAt: now + 1800,
      providerSpecificData: { copilotApiUrl: `https://copilot-api.${tenant}.example.test` }
    }));
    expect(network.calls).toHaveLength(6);
    for (const { url, proxy } of network.calls) expect(proxy).toBe(tenantOf(url));

    network.restore();
    network = installTransport(async () => new Response("synthetic-secret", { status: 401 }));
    const rejected = await new GheCopilotExecutor().refreshCredentials({ accessToken: "oauth-alpha", refreshToken: "refresh-alpha", providerSpecificData: { gheUrl: origin("alpha") } }, log, proxyFor("alpha"));
    expect(rejected).toBeNull();
    expect(network.calls).toHaveLength(2);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("synthetic-secret");
  });

  it("routes requests and streams only to the connection's trusted API host", async () => {
    const executor = new GheCopilotExecutor();
    const psd = (copilotApiUrl) => ({ providerSpecificData: { gheUrl: origin("alpha"), copilotApiUrl, copilotToken: "session-alpha" } });
    expect(executor.endpointUrl("baseUrl", psd("https://collector.attacker.test"))).toBe(`${origin("alpha")}/chat/completions`);
    expect(executor.endpointUrl("messagesUrl", psd("https://copilot-api.alpha.example.test/"))).toBe("https://copilot-api.alpha.example.test/v1/messages");
    expect(executor.endpointUrl("responsesUrl", psd("https://api.enterprise.githubcopilot.com"))).toBe("https://api.enterprise.githubcopilot.com/responses");
    expect(PROVIDERS["ghe-copilot"].countTokensUrl).toBeUndefined();

    const sse = 'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    network = installTransport(async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }));
    const send = (credentials) => executor.execute({
      model: "gpt-4.1", stream: true, body: { model: "gpt-4.1", stream: true, messages: [{ role: "user", content: "hello" }] },
      credentials, proxyOptions: proxyFor("alpha")
    });
    // register-auth-02: a historical (unbound) session with no stated expiry is
    // re-minted first (needsRefresh) and is never dispatched as-is.
    const historical = { connectionId: "alpha", ...psd("https://collector.attacker.test") };
    expect(executor.needsRefresh(historical)).toBe(true);
    await expect(send(historical)).rejects.toMatchObject({ code: "reauthentication_needed" });
    expect(network.calls).toHaveLength(0);
    historical.providerSpecificData.copilotTokenExpiresAt = Math.floor(Date.now() / 1000) + 3600;
    const result = await send(historical);
    expect(network.calls).toHaveLength(1);
    const [{ url, init, proxy }] = network.calls;
    expect(url).toBe(`${origin("alpha")}/chat/completions`);
    expect(headerOf(init, "authorization")).toBe("Bearer session-alpha");
    expect(init.redirect).toBe("error");
    expect(proxy).toBe("alpha");
    expect(await result.response.text()).toContain('"content":"hi"');
  });

  it("supports bound model discovery through the staged discovery slot", async () => {
    network = installTransport(async ({ url }) => url.endsWith("/models")
      ? Response.json({ data: [{ id: "tenant-model" }] })
      : new Response(null, { status: 302, headers: { location: "https://other.example.test" } }));
    const data = { gheUrl: origin("beta"), copilotApiUrl: "https://collector.attacker.test", copilotToken: "session-beta" };
    const binding = ghe.bindGheConnection({ gheUrl: data.gheUrl, proxyOptions: proxyFor("beta") });
    const base = ghe.resolveBoundGheApiBase(data);
    expect(base).toBe(origin("beta"));
    const response = await ghe.gheBoundFetch(binding, `${base}/models`, { headers: { Authorization: `Bearer ${data.copilotToken}` } });
    expect(await response.json()).toEqual({ data: [{ id: "tenant-model" }] });
    await expect(ghe.gheBoundFetch(binding, `${base}/redirect`)).rejects.toMatchObject({ code: "redirect_refused" });
    expect(network.calls.map(({ proxy }) => proxy)).toEqual(["beta", "beta"]);
  });
});

// The manifest stays immutable and still says "staged"; the auth batch
// (register-auth-02) wired its four slots, so each callsite is checked
// positively for the helper it must call and for the removed path.
describe("staged Copilot registration manifest", () => {
  it("lists real exports and wires every central callsite", async () => {
    const { readFileSync } = await import("node:fs");
    const root = new URL("../../", import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL("src/lib/oauth/providerParity/copilot/registration.json", root), "utf8"));
    expect(manifest.status).toBe("staged");
    for (const [file, names] of Object.entries(manifest.modules)) {
      const mod = await import(new URL(file, root).href);
      expect(Object.keys(mod).sort()).toEqual([...names].sort());
    }
    expect(manifest.integrationSlots).toHaveLength(4);
    const wired = {
      "src/lib/oauth/providers.js": { calls: ["decodeCopilotPollResponse(await response.text())"], removed: [] },
      "open-sse/services/tokenRefresh.js": { calls: ['"ghe-copilot": (c, log, p) => refreshBoundGheCopilotCredentials(c, log, gheSelectedProxy(c, p))'], removed: ["refreshGheCopilotCredentials("] },
      "src/app/api/providers/[id]/models/modelsConfig.js": { calls: ["gheRequestContext(sending, gheSelectedProxy(sending, proxyOptions))", "gheBoundFetch(context.binding, `${context.base}/models`"], removed: ["resolveGheCopilotApiBase("] },
      "src/app/api/providers/[id]/test/testUtils.js": { calls: ["storedGheBinding(connection, gheSelectedProxy(connection, effectiveProxy), { refresh: true })", "gheBoundFetch(gheBinding, testUrl, fetchOpts)"], removed: ["normalizeGheUrl("] }
    };
    for (const { callsite } of manifest.integrationSlots) {
      const [, file] = callsite.match(/^(\S+):(\d+) (.+)$/);
      const source = readFileSync(new URL(file, root), "utf8");
      expect(wired[file], file).toBeDefined();
      for (const call of wired[file].calls) expect(source).toContain(call);
      for (const gone of wired[file].removed) expect(source).not.toContain(gone);
    }
  });
});
