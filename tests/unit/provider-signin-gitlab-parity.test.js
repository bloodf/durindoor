import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeTokens, generateAuthData, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { GITLAB_DUO_CONFIG } from "../../src/lib/oauth/constants/oauth.js";
import { GitlabExecutor } from "../../open-sse/executors/gitlab.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import {
  buildGitLabDirectGatewayUrl,
  parseGitLabDirectAccess,
  readCachedGitLabDirectAccess
} from "../../src/lib/oauth/providerParity/gitlab/directAccess.js";

const storage = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: storage.create }));
// Closed network: hostname checks resolve to a fixed public address.
vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal();
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const mod = { ...actual, promises: { ...actual.promises, lookup } };
  return { ...mod, default: mod };
});

// The proxy transport is replaced so each send's route is visible to the fake fetch.
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...await importOriginal(),
  proxyAwareFetch: (url, options, proxyOptions) => globalThis.fetch(url, { ...options, proxyOptions })
}));

const NOW = Date.parse("2026-11-27T12:00:00Z");
const PRIVATE_BODY = "synthetic-upstream-private-body";
const DEPLOYMENT_SECRET = "synthetic-deployment-secret";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  storage.create.mockReset();
});

function oauthCredentials(id, data = {}) {
  return {
    accessToken: `oauth-${id}`,
    providerSpecificData: { baseUrl: `https://${id}.example.com`, clientId: `client-${id}`, authKind: "oauth", ...data }
  };
}

function directPayload(id, expiresInSeconds = 3600) {
  return {
    token: `gateway-${id}`,
    base_url: `https://gateway-${id}.example.net`,
    ...(expiresInSeconds === null ? {} : { expires_at: Math.floor(NOW / 1000) + expiresInSeconds }),
    headers: {
      "X-Gitlab-Instance-Id": `instance-${id}`,
      Authorization: "Bearer injected",
      "X-Other": "dropped",
      "X-Gitlab-Split": "a\r\nb"
    }
  };
}

function cachedEntry(id, expiresAtMs, issuer = `https://${id}.example.com`) {
  return { token: `cached-${id}`, baseUrl: `https://gateway-${id}.example.net`, expiresAt: new Date(expiresAtMs).toISOString(), headers: {}, issuer };
}

function run(credentials, extra = {}) {
  return new GitlabExecutor().execute({
    model: "example",
    body: { messages: [{ role: "user", content: "hello" }] },
    stream: false,
    credentials,
    ...extra
  });
}

const completion = (text = "answer") => Response.json({ choices: [{ text }] });
const isExchange = (url) => String(url).endsWith("/api/v4/code_suggestions/direct_access");
const isMonolith = (url) => String(url).endsWith("/api/v4/code_suggestions/completions");
const isGateway = (url) => String(url).endsWith("/ai/v2/completions");

describe("GitLab production contracts", () => {
  it.each(["gitlab", "gitlab-duo"])("rejects unsupported %s device sign-in before transport", async (provider) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(requestDeviceCode(provider)).rejects.toThrow("does not support device code flow");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["gitlab", "gitlab-duo"])("does not expose a rejected %s exchange body", async (provider) => {
    const fetch = vi.fn().mockResolvedValue(new Response(PRIVATE_BODY, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const failure = exchangeTokens(provider, "code", "http://localhost/callback", "verifier", "state", {
      baseUrl: "https://gitlab.example.com", clientId: "client"
    });
    await expect(failure).rejects.toThrow(/^GitLab(?: Duo)? token exchange failed$/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent Duo exchanges bound to their own client, verifier and instance", async () => {
    const fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/oauth/token")) {
        const body = new URLSearchParams(init.body);
        return Response.json({ access_token: `access-${body.get("client_id")}` });
      }
      return Response.json({ username: init.headers.Authorization });
    });
    vi.stubGlobal("fetch", fetch);
    const metas = ["one", "two"].map((id) => ({ baseUrl: `https://${id}.example.com`, clientId: id }));
    const auth = await Promise.all(metas.map((meta) => generateAuthData("gitlab-duo", "http://localhost/callback", meta)));
    expect(auth[0].state).not.toBe(auth[1].state);
    const results = await Promise.all(metas.map((meta, i) =>
      exchangeTokens("gitlab-duo", `code-${i}`, auth[i].redirectUri, auth[i].codeVerifier, auth[i].state, meta)));
    for (const [i, meta] of metas.entries()) {
      expect(results[i]).toMatchObject({
        accessToken: `access-${meta.clientId}`,
        providerSpecificData: { ...meta, username: `Bearer access-${meta.clientId}`, authKind: "oauth" }
      });
      const call = fetch.mock.calls.find(([url]) => url === `${meta.baseUrl}/oauth/token`);
      expect(new URLSearchParams(call[1].body).get("code_verifier")).toBe(auth[i].codeVerifier);
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("sends the deployment client secret only to the deployment's own instance", async () => {
    const fetch = vi.fn(async (url) => String(url).endsWith("/oauth/token") ?
      Response.json({ access_token: "access" }) : Response.json({ username: "user" }));
    vi.stubGlobal("fetch", fetch);
    const saved = { clientSecret: GITLAB_DUO_CONFIG.clientSecret, defaultBaseUrl: GITLAB_DUO_CONFIG.defaultBaseUrl };
    Object.assign(GITLAB_DUO_CONFIG, { clientSecret: DEPLOYMENT_SECRET, defaultBaseUrl: "https://deployment.example.com" });
    try {
      await exchangeTokens("gitlab-duo", "code", "http://localhost/callback", "verifier", "state", {
        baseUrl: "https://foreign.example.com", clientId: "client"
      });
      await exchangeTokens("gitlab-duo", "code", "http://localhost/callback", "verifier", "state", {
        baseUrl: "https://deployment.example.com", clientId: "client"
      });
    } finally {
      Object.assign(GITLAB_DUO_CONFIG, saved);
    }
    const sent = (origin) => fetch.mock.calls.filter(([url]) => String(url).startsWith(origin)).map((call) => JSON.stringify(call));
    expect(sent("https://foreign.example.com").join("")).not.toContain(DEPLOYMENT_SECRET);
    expect(sent("https://deployment.example.com").join("")).toContain(DEPLOYMENT_SECRET);
  });

  it.each(["gitlab", "gitlab-duo"])("verifies and stores a %s PAT using the existing route", async (provider) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ username: "synthetic-user" }));
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("../../src/app/api/oauth/gitlab/pat/route.js");
    const response = await POST({ json: async () => ({ provider, baseUrl: "https://gitlab.example.com", token: "synthetic-pat" }) });
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { "Private-Token": "synthetic-pat" }, redirect: "manual" });
    expect(storage.create).toHaveBeenCalledWith(expect.objectContaining({
      provider, accessToken: "synthetic-pat", providerSpecificData: expect.objectContaining({ authKind: "personal_access_token" })
    }));
  });

  it("refreshes concurrent accounts against their own instance and client", async () => {
    const fetch = vi.fn(async (_url, init) => Response.json({ access_token: `new-${init.body.get("client_id")}`, expires_in: 3600 }));
    vi.stubGlobal("fetch", fetch);
    const results = await Promise.all(["one", "two"].map((id) => refreshTokenByProvider("gitlab-duo", {
      refreshToken: `refresh-${id}`, providerSpecificData: { baseUrl: `https://${id}.example.com`, clientId: id }
    }, null)));
    for (const [i, id] of ["one", "two"].entries()) {
      expect(results[i]).toMatchObject({
        accessToken: `new-${id}`, refreshToken: `refresh-${id}`,
        providerSpecificData: { baseUrl: `https://${id}.example.com`, clientId: id }
      });
      const call = fetch.mock.calls.find(([url]) => String(url) === `https://${id}.example.com/oauth/token`);
      expect(call[1].body.get("refresh_token")).toBe(`refresh-${id}`);
      expect(call[1].body.get("client_id")).toBe(id);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns invalid_grant for a rejected Duo refresh without returning the upstream body", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(PRIVATE_BODY, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const result = await refreshTokenByProvider("gitlab-duo", {
      refreshToken: "refresh", providerSpecificData: { baseUrl: "https://gitlab.example.com", clientId: "client" }
    }, null);
    expect(result).toEqual({ error: "invalid_grant" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("GitLab Duo public completions (PAT and untyped connections)", () => {
  it("preserves concurrent instance and credential identity without a direct-access exchange", async () => {
    const fetch = vi.fn(async (url, init) => Response.json({ choices: [{ text: `${url}:${init.headers.Authorization}` }] }));
    vi.stubGlobal("fetch", fetch);
    const credentials = [
      { accessToken: "token-one", providerSpecificData: { baseUrl: "https://one.example.com", projectPath: "project-one" } },
      { accessToken: "token-two", providerSpecificData: { baseUrl: "https://two.example.com", projectPath: "project-two", authKind: "personal_access_token" } }
    ];
    const results = await Promise.all(credentials.map((c) => run(c)));
    for (const [i, id] of ["one", "two"].entries()) {
      const result = await results[i].response.json();
      expect(result.choices[0].message.content).toBe(`https://${id}.example.com/api/v4/code_suggestions/completions:Bearer token-${id}`);
      const call = fetch.mock.calls.find(([url]) => String(url).startsWith(`https://${id}.example.com/`));
      expect(JSON.parse(call[1].body).project_path).toBe(`project-${id}`);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.some(([url]) => isExchange(url))).toBe(false);
  });

  it("keeps the hidden gitlab variant off the Duo direct-access path", async () => {
    const fetch = vi.fn().mockResolvedValue(completion());
    vi.stubGlobal("fetch", fetch);
    await new GitlabExecutor("gitlab").execute({
      model: "example", body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: oauthCredentials("one")
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(isMonolith(fetch.mock.calls[0][0])).toBe(true);
  });

  it.each([400, 401, 429, 500])("returns a fixed %s error without the provider body", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: PRIVATE_BODY }), { status })));
    const { response } = await run({ accessToken: "token", providerSpecificData: { baseUrl: "https://gitlab.example.com" } });
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).not.toContain(PRIVATE_BODY);
    expect(JSON.parse(text).error.message).toMatch(/^GitLab Duo /);
  });

  it("translates a completion into a buffered event stream with one upstream submission", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ text: "answer" }], usage: { total_tokens: 7 } }));
    vi.stubGlobal("fetch", fetch);
    const result = await run({ accessToken: "synthetic-token", providerSpecificData: { baseUrl: "https://gitlab.example.com" } }, { stream: true });
    const body = await result.response.text();
    expect(body).toContain('"content":"answer"');
    expect(body).toContain('"total_tokens":7');
    expect(body).toContain("data: [DONE]");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not submit an already aborted request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(run(oauthCredentials("one"), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("GitLab Duo OAuth direct access", () => {
  it("exchanges and routes two concurrent accounts through their own gateway, token and proxy", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const fetch = vi.fn(async (url, init) => {
      const id = new URL(url).hostname.match(/(one|two)/)[1];
      if (isExchange(url)) return Response.json(directPayload(id));
      return completion(`${id}:${init.headers.Authorization}:${init.headers["X-Gitlab-Instance-Id"]}`);
    });
    vi.stubGlobal("fetch", fetch);
    const proxies = { one: { connectionProxyUrl: "http://proxy-one.test:8080" }, two: { connectionProxyUrl: "http://proxy-two.test:8080" } };
    const persisted = { one: vi.fn(), two: vi.fn() };
    const results = await Promise.all(["one", "two"].map((id) =>
      run(oauthCredentials(id), { proxyOptions: proxies[id], persistGitLabDirectAccess: persisted[id] })));

    expect(fetch).toHaveBeenCalledTimes(4);
    for (const [i, id] of ["one", "two"].entries()) {
      const json = await results[i].response.json();
      expect(json.choices[0].message.content).toBe(`${id}:Bearer gateway-${id}:instance-${id}`);
      const exchange = fetch.mock.calls.find(([url]) => url === `https://${id}.example.com/api/v4/code_suggestions/direct_access`);
      expect(exchange[1]).toMatchObject({ method: "POST", redirect: "error", proxyOptions: proxies[id] });
      expect(exchange[1].headers.Authorization).toBe(`Bearer oauth-${id}`);
      const gateway = fetch.mock.calls.find(([url]) => url === `https://gateway-${id}.example.net/ai/v2/completions`);
      expect(gateway[1]).toMatchObject({ redirect: "error", proxyOptions: proxies[id] });
      expect(gateway[1].headers).toEqual({
        "X-Gitlab-Instance-Id": `instance-${id}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer gateway-${id}`
      });
      expect(persisted[id]).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        token: `gateway-${id}`, issuer: `https://${id}.example.com`, expiresAt: new Date(NOW + 3_600_000).toISOString()
      }));
    }
  });

  it("reuses a stored gateway entry until 60 seconds before expiry, then exchanges again", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const fetch = vi.fn(async (url) => isExchange(url) ? Response.json(directPayload("one")) : completion());
    vi.stubGlobal("fetch", fetch);
    const credentials = oauthCredentials("one", { gitlabDirectAccess: cachedEntry("one", NOW + 120_000) });
    const persist = vi.fn();

    await run(credentials, { persistGitLabDirectAccess: persist });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe("https://gateway-one.example.net/ai/v2/completions");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer cached-one");
    expect(persist).not.toHaveBeenCalled();

    vi.setSystemTime(NOW + 60_001);
    fetch.mockClear();
    await run(credentials, { persistGitLabDirectAccess: persist });
    expect(fetch.mock.calls.map(([url]) => isExchange(url))).toEqual([true, false]);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer gateway-one");
    expect(persist).toHaveBeenCalledOnce();
  });

  it("ignores a stored entry issued for another instance", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const fetch = vi.fn(async (url) => isExchange(url) ? Response.json(directPayload("one")) : completion());
    vi.stubGlobal("fetch", fetch);
    await run(oauthCredentials("one", { gitlabDirectAccess: cachedEntry("two", NOW + 3_600_000, "https://two.example.com") }));
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://one.example.com/api/v4/code_suggestions/direct_access",
      "https://gateway-one.example.net/ai/v2/completions"
    ]);
  });

  it("uses an entry without expiry for one request and never stores it", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const fetch = vi.fn(async (url) => isExchange(url) ? Response.json(directPayload("one", null)) : completion());
    vi.stubGlobal("fetch", fetch);
    const persist = vi.fn();
    await run(oauthCredentials("one"), { persistGitLabDirectAccess: persist });
    expect(isGateway(fetch.mock.calls[1][0])).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 500])("falls back to public completions after a %s exchange without exposing it", async (status) => {
    const fetch = vi.fn(async (url) => isExchange(url) ? new Response(PRIVATE_BODY, { status }) : completion());
    vi.stubGlobal("fetch", fetch);
    const { response } = await run(oauthCredentials("one"));
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://one.example.com/api/v4/code_suggestions/direct_access",
      "https://one.example.com/api/v4/code_suggestions/completions"
    ]);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer oauth-one");
    expect(await response.text()).not.toContain(PRIVATE_BODY);
  });

  it.each([
    ["an http gateway", { base_url: "http://gateway.example.net" }],
    ["a gateway with credentials", { base_url: "https://user:pass@gateway.example.net" }],
    ["a metadata gateway", { base_url: "https://169.254.169.254" }],
    ["a token with a line break", { token: "a\r\nb" }]
  ])("rejects %s and uses public completions", async (_label, override) => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const fetch = vi.fn(async (url) => isExchange(url) ? Response.json({ ...directPayload("one"), ...override }) : completion());
    vi.stubGlobal("fetch", fetch);
    const persist = vi.fn();
    await run(oauthCredentials("one"), { persistGitLabDirectAccess: persist });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(isMonolith(fetch.mock.calls[1][0])).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("replays once to public completions after a gateway auth rejection and clears the stored entry", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const fetch = vi.fn(async (url) => isGateway(url) ? new Response(PRIVATE_BODY, { status: 401 }) : completion("public"));
    vi.stubGlobal("fetch", fetch);
    const persist = vi.fn();
    const { response, url } = await run(oauthCredentials("one", { gitlabDirectAccess: cachedEntry("one", NOW + 3_600_000) }), {
      persistGitLabDirectAccess: persist
    });
    expect(fetch.mock.calls.map(([u]) => String(u))).toEqual([
      "https://gateway-one.example.net/ai/v2/completions",
      "https://one.example.com/api/v4/code_suggestions/completions"
    ]);
    expect(persist).toHaveBeenCalledExactlyOnceWith(null);
    expect(url).toBe("https://one.example.com/api/v4/code_suggestions/completions");
    expect((await response.json()).choices[0].message.content).toBe("public");
  });

  it.each([429, 500, 502])("does not replay accepted gateway work after a %s and hides the body", async (status) => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const fetch = vi.fn().mockResolvedValue(new Response(PRIVATE_BODY, { status }));
    vi.stubGlobal("fetch", fetch);
    const { response } = await run(oauthCredentials("one", { gitlabDirectAccess: cachedEntry("one", NOW + 3_600_000) }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain(PRIVATE_BODY);
  });

  it("does not replay after a gateway transport failure", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const fetch = vi.fn().mockRejectedValue(new TypeError("socket closed"));
    vi.stubGlobal("fetch", fetch);
    await expect(run(oauthCredentials("one", { gitlabDirectAccess: cachedEntry("one", NOW + 3_600_000) }))).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("stops without a completion submission when cancelled during the exchange", async () => {
    const controller = new AbortController();
    const fetch = vi.fn((url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      controller.abort();
    }));
    vi.stubGlobal("fetch", fetch);
    await expect(run(oauthCredentials("one"), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(isExchange(fetch.mock.calls[0][0])).toBe(true);
  });

  it("streams a gateway completion as one buffered event stream", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const fetch = vi.fn(async (url) => isExchange(url) ? Response.json(directPayload("one")) : completion("streamed"));
    vi.stubGlobal("fetch", fetch);
    const { response } = await run(oauthCredentials("one"), { stream: true });
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const body = await response.text();
    expect(body).toContain('"content":"streamed"');
    expect(body.trim().endsWith("data: [DONE]")).toBe(true);
    expect(fetch.mock.calls.filter(([url]) => isGateway(url))).toHaveLength(1);
  });

  it("never sends the deployment client secret on the request path", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    vi.stubEnv("GITLAB_DUO_OAUTH_CLIENT_SECRET", DEPLOYMENT_SECRET);
    vi.stubEnv("GITLAB_OAUTH_CLIENT_SECRET", DEPLOYMENT_SECRET);
    const fetch = vi.fn(async (url) => isExchange(url) ? new Response("", { status: 401 }) : completion());
    vi.stubGlobal("fetch", fetch);
    await run(oauthCredentials("one"));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fetch.mock.calls)).not.toContain(DEPLOYMENT_SECRET);
  });
});

describe("GitLab direct-access helper contract", () => {
  it("derives the gateway URL exactly as the OmniRoute source does", () => {
    expect(buildGitLabDirectGatewayUrl("https://g.example.net")).toBe("https://g.example.net/ai/v2/completions");
    expect(buildGitLabDirectGatewayUrl("https://g.example.net/ai/v2")).toBe("https://g.example.net/ai/v2/completions");
    expect(buildGitLabDirectGatewayUrl("https://g.example.net/ai/v2/completions")).toBe("https://g.example.net/ai/v2/completions");
  });

  it("keeps only GitLab routing headers and binds the entry to its issuer", () => {
    const entry = parseGitLabDirectAccess(directPayload("one"), "https://one.example.com");
    expect(entry.headers).toEqual({ "X-Gitlab-Instance-Id": "instance-one" });
    expect(readCachedGitLabDirectAccess({ gitlabDirectAccess: entry }, "https://one.example.com", NOW)).not.toBeNull();
    expect(readCachedGitLabDirectAccess({ gitlabDirectAccess: entry }, "https://two.example.com", NOW)).toBeNull();
  });
});

// Staged only: these helpers are not wired into production yet (registration.json).
describe("staged GitLab OAuth binding", () => {
  it("attaches the deployment secret only for the deployment's own instance and client", async () => {
    const { bindGitLabOAuthClient } = await import("../../src/lib/oauth/providerParity/gitlab/oauthBinding.js");
    const deployment = { baseUrl: "https://gitlab.example.com", clientId: "deployment", clientSecret: DEPLOYMENT_SECRET };
    expect(bindGitLabOAuthClient({ baseUrl: "https://gitlab.example.com/", clientId: "deployment" }, deployment))
      .toMatchObject({ tokenUrl: "https://gitlab.example.com/oauth/token", clientId: "deployment", clientSecret: DEPLOYMENT_SECRET });
    expect(bindGitLabOAuthClient({}, deployment).clientSecret).toBe(DEPLOYMENT_SECRET);
    for (const data of [
      { baseUrl: "https://other.example.com", clientId: "deployment" },
      { baseUrl: "https://gitlab.example.com/sub", clientId: "deployment" },
      { baseUrl: "https://gitlab.example.com", clientId: "connection-client" }
    ]) {
      const bound = bindGitLabOAuthClient(data, deployment);
      expect(bound.clientSecret).toBe("");
      expect(bound.dedupKey).toBe(`gitlab-duo:${bound.root}:${bound.clientId}`);
    }
    for (const baseUrl of ["https://gitlab.example.com/?x=1", "https://user@gitlab.example.com", "ftp://gitlab.example.com", "invalid"]) {
      expect(bindGitLabOAuthClient({ baseUrl, clientId: "deployment" }, deployment)).toBeNull();
    }
  });
});
