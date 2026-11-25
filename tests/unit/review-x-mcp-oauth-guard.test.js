// Issue 2522: MCP OAuth discovery, registration and token exchange must use the
// guarded outbound fetch, and pending exchanges must expire and be single-use.
// `fetch` is always stubbed: nothing here touches the network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstanceById: vi.fn(), updateInstance: vi.fn(), storeTokens: vi.fn()
}));
vi.mock("@/lib/localDb", () => ({
  getInstanceById: mocks.getInstanceById, updateInstance: mocks.updateInstance
}));
vi.mock("@/lib/mcp/gateway/oauthRefresh", () => ({ storeTokens: mocks.storeTokens }));

import { discoverAuth } from "@/lib/mcp/gateway/oauthDiscovery";
import { registerClient } from "@/lib/mcp/gateway/oauthRegister";
import {
  registerMcpSession,
  getMcpSessionStatus,
  clearMcpSession
} from "@/lib/oauth/utils/server";
import { GET } from "../../src/app/api/mcp-gateway/oauth/[id]/[action]/route.js";

const UPSTREAM = "https://upstream.example";
const TOKEN_URL = "https://as.example/token";
const REGISTER_URL = "https://as.example/register";
const REDIRECT_URI = "https://router.example/callback";
const BLOCKED = [
  "http://169.254.169.254/latest/meta-data",
  "http://169.254.10.20/oauth",
  "http://metadata.google.internal/oauth",
  "http://[fd00:ec2::254]/oauth"
];
const TTL_MS = 300_000;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const redirect = (location, status = 307) => new Response(null, { status, headers: { location } });
const stubFetch = (impl) => vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => impl(String(url), init));
const requested = (spy) => spy.mock.calls.map(([url]) => String(url));

const created = [];
let counter = 0;
function newSession(id = "inst") {
  const state = `state-${++counter}`;
  registerMcpSession({
    instanceId: id, state, codeVerifier: "verifier", redirectUri: REDIRECT_URI, clientId: "client"
  });
  created.push([id, state]);
  return state;
}

const call = (action, query, id = "inst") => GET(
  new Request(`https://router.example/api/mcp-gateway/oauth/${id}/${action}?${new URLSearchParams(query)}`),
  { params: Promise.resolve({ id, action }) }
);
const callback = (state) => call("callback", { code: "code", state });
const statusOf = async (state) => (await call("status", { state })).json();

function useTokenEndpoint(tokenEndpoint) {
  mocks.getInstanceById.mockResolvedValue({
    id: "inst", url: UPSTREAM, oauthTokens: { as: tokenEndpoint ? { token_endpoint: tokenEndpoint } : {} }
  });
}

beforeEach(() => {
  vi.stubEnv("OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS", "");
  vi.stubEnv("OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS", "true");
  vi.useFakeTimers();
  vi.clearAllMocks();
  useTokenEndpoint(TOKEN_URL);
});

afterEach(() => {
  for (const [id, state] of created.splice(0)) clearMcpSession(id, state);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("outbound guard on MCP OAuth fetches", () => {
  it.each(BLOCKED)("never requests the blocked target %s", async (target) => {
    const spy = stubFetch(() => json({ authorization_servers: [target] }));
    await discoverAuth(UPSTREAM, { wwwAuthenticate: `Bearer resource_metadata="${target}"` });
    await expect(registerClient(target, REDIRECT_URI)).rejects.toThrow("blocked by the outbound URL guard");
    useTokenEndpoint(target);
    const state = newSession();
    expect((await callback(state)).status).toBe(500);
    expect(requested(spy).length).toBeGreaterThan(0);
    for (const url of requested(spy)) expect(new URL(url).hostname).toBe("upstream.example");
    expect((await statusOf(state)).error).toBe("token endpoint blocked by the outbound URL guard");
  });

  it("re-checks every discovery redirect hop", async () => {
    const spy = stubFetch((url) => url.startsWith(UPSTREAM)
      ? redirect("https://hop.example/doc", 302)
      : redirect(BLOCKED[0], 302));
    expect(await discoverAuth(UPSTREAM)).toBeNull();
    expect(requested(spy)).toContain("https://hop.example/doc");
    expect(requested(spy)).not.toContain(BLOCKED[0]);
    for (const [, init] of spy.mock.calls) {
      expect(init.redirect).toBe("manual");
      expect(init.dispatcher).toBeDefined();
    }
  });

  it("follows an allowed discovery redirect", async () => {
    stubFetch((url) => {
      if (url === `${UPSTREAM}/.well-known/oauth-protected-resource`) return redirect("https://hop.example/doc", 301);
      if (url === "https://hop.example/doc") return json({ authorization_servers: ["https://as.example"] });
      return json({ token_endpoint: TOKEN_URL });
    });
    expect((await discoverAuth(UPSTREAM))?.token_endpoint).toBe(TOKEN_URL);
  });

  it("rejects a cross-origin 307 on the registration POST", async () => {
    const spy = stubFetch(() => redirect("https://other.example/register"));
    await expect(registerClient(REGISTER_URL, REDIRECT_URI)).rejects.toThrow("crossed origin");
    expect(requested(spy)).toEqual([REGISTER_URL]);
    expect(spy.mock.calls[0][1].redirect).toBe("manual");
  });

  it("follows a same-origin 308 on the registration POST", async () => {
    const spy = stubFetch((url) => url === REGISTER_URL ? redirect("/v2/register", 308) : json({ client_id: "abc" }));
    expect((await registerClient(REGISTER_URL, REDIRECT_URI)).clientId).toBe("abc");
    expect(requested(spy)).toEqual([REGISTER_URL, "https://as.example/v2/register"]);
    expect(spy.mock.calls[1][1].method).toBe("POST");
  });

  it("rejects a cross-origin 307 on the token POST", async () => {
    const spy = stubFetch(() => redirect("https://other.example/token"));
    const state = newSession();
    expect((await callback(state)).status).toBe(500);
    expect(requested(spy)).toEqual([TOKEN_URL]);
    expect(await statusOf(state)).toEqual({ status: "error", error: "token redirect crossed origin" });
    expect(mocks.storeTokens).not.toHaveBeenCalled();
  });

  it("does not echo the registration response body", async () => {
    stubFetch(() => new Response("INTERNAL-SECRET", { status: 400 }));
    const error = await registerClient(REGISTER_URL, REDIRECT_URI).catch((e) => e);
    expect(error.message).toBe("registration failed with status 400");
  });

  it.each([400, 200])("does not echo a %i token response body", async (status) => {
    stubFetch(() => new Response("INTERNAL-SECRET", { status }));
    const state = newSession();
    const page = await (await callback(state)).text();
    const polled = await statusOf(state);
    expect(polled.status).toBe("error");
    expect(page + polled.error).not.toContain("INTERNAL");
  });
});

describe("MCP pending exchanges", () => {
  const tokens = () => json({ access_token: "token" });

  it("rejects an expired state without calling the token endpoint", async () => {
    const spy = stubFetch(tokens);
    const state = newSession();
    vi.setSystemTime(Date.now() + TTL_MS);
    expect((await callback(state)).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
    expect(getMcpSessionStatus("inst", state)).toBeNull();
  });

  it("redeems a state once, including while the first exchange is in flight", async () => {
    let release;
    const spy = stubFetch(() => new Promise((resolve) => { release = resolve; }));
    const state = newSession();
    const first = callback(state);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(getMcpSessionStatus("inst", state)).not.toHaveProperty("codeVerifier");
    expect((await callback(state)).status).toBe(400);
    expect((await statusOf(state)).status).toBe("processing");
    release(tokens());
    expect((await first).status).toBe(200);
    expect((await statusOf(state)).status).toBe("complete");
    expect((await callback(state)).status).toBe(400);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getMcpSessionStatus("inst", state)).toBeNull();
  });

  it.each([
    ["no token_endpoint", { code: "code" }],
    ["provider error", { error: "access_denied" }],
    ["missing code", {}]
  ])("clears the entry after the %s error return", async (label, query) => {
    if (label === "no token_endpoint") useTokenEndpoint(null);
    const spy = stubFetch(tokens);
    const state = newSession();
    await call("callback", { ...query, state });
    expect((await statusOf(state)).status).toBe("error");
    expect(getMcpSessionStatus("inst", state)).not.toHaveProperty("codeVerifier");
    useTokenEndpoint(TOKEN_URL);
    expect((await callback(state)).status).toBe(400);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getMcpSessionStatus("inst", state)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("clears the entry when the instance is gone", async () => {
    mocks.getInstanceById.mockResolvedValue(null);
    const state = newSession();
    expect((await callback(state)).status).toBe(404);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getMcpSessionStatus("inst", state)).toBeNull();
  });

  it("sweeps expired entries on insert", () => {
    const start = Date.now();
    const stale = newSession();
    vi.setSystemTime(start + TTL_MS);
    newSession();
    // Rewind so only the sweep, not the read-side expiry check, can explain it.
    vi.setSystemTime(start);
    expect(getMcpSessionStatus("inst", stale)).toBeNull();
  });

  it("bounds the map by evicting the oldest entry", () => {
    const states = Array.from({ length: 101 }, () => newSession());
    expect(getMcpSessionStatus("inst", states[0])).toBeNull();
    expect(states.filter((state) => getMcpSessionStatus("inst", state))).toHaveLength(100);
  });
});
