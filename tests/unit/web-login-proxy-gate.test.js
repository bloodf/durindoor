import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const guards = vi.hoisted(() => ({ proxy: vi.fn(async () => new Response("dashboard")), canAccessManagementApi: vi.fn(async () => true) }));
vi.mock("../../src/dashboardGuard", () => guards);
vi.mock("open-sse/providers/registry/index.js", () => ({ default: [
  { id: "cookie-web", webLogin: { origin: "https://provider.example", startUrl: "https://provider.example/login", allowedHosts: ["identity.example"], cookieNames: ["session"] } },
] }));

import proxy from "../../src/proxy.js";
import { beginSession, destroySession, issueBootstrap, proxySessionCookie, composeCookieHeader, SESSION_TTL_MS } from "../../src/lib/webLoginSession.js";

const LOGIN = "https://login.example";
const DASHBOARD = "https://dashboard.example";
let sessions;
let upstream;
function session() {
  const sess = beginSession("cookie-web", { loginOrigin: LOGIN, dashboardOrigin: DASHBOARD });
  sessions.push(sess);
  return sess;
}
function request(path, cookie = "", origin = LOGIN, method = "GET") {
  return new NextRequest(`${origin}${path}`, { method, headers: {
    cookie, authorization: "Bearer forged-auth", "x-api-key": "forged-key", "x-9r-cli-token": "forged-token", "x-forwarded-host": "dashboard.example",
  } });
}
beforeEach(() => {
  sessions = [];
  vi.clearAllMocks();
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", LOGIN);
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  upstream = vi.fn(async () => new Response("provider", { headers: { "content-type": "text/plain" } }));
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => { for (const sess of sessions) destroySession(sess.id); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("isolated web-login proxy gate", () => {
  it("denies dashboard, admin and secret paths even with forged auth and a valid proxy session", async () => {
    const cookie = `${proxySessionCookie(session()).split(";")[0]}; auth_token=forged; dd_mimo_login=forged`;
    for (const path of ["/", "/dashboard/providers", "/login", "/_next/static/app.js", "/api/providers", "/api/providers/connection.example/reveal", "/api/keys", "/api/settings", "/api/settings/database/cutover", "/api/providers/web-login/start", "/v1/chat/completions", "/admin"]) {
      expect((await proxy(request(path, cookie))).status, path).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();
    expect(guards.proxy).not.toHaveBeenCalled();
    expect(guards.canAccessManagementApi).not.toHaveBeenCalled();
  });

  it("rejects missing sessions, mismatched providers, foreign hosts and wrong-port login origins", async () => {
    const cookie = proxySessionCookie(session()).split(";")[0];
    for (const [path, value, origin] of [
      ["/__web_login/cookie-web/login", "", LOGIN],
      ["/__web_login/other-provider/login", cookie, LOGIN],
      ["/__web_login/cookie-web/__host/evil.example/login", cookie, LOGIN],
      ["/__web_login/cookie-web/login", cookie, "https://login.example:9443"],
      ["/__web_login/cookie-web/login", cookie, DASHBOARD],
    ]) expect((await proxy(request(path, value, origin))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
    expect(guards.proxy).not.toHaveBeenCalled();
    await proxy(request("/dashboard/providers", "", DASHBOARD));
    expect(guards.proxy).toHaveBeenCalledTimes(1);
  });

  it("consumes a bootstrap grant, captures upstream cookies, then fetches with only provider cookies", async () => {
    const sess = session();
    const bootstrapUrl = new URL(issueBootstrap(sess));
    const bootstrapPath = bootstrapUrl.pathname + bootstrapUrl.search;
    const entered = await proxy(request(bootstrapPath));
    expect(entered.status).toBe(303);
    expect(entered.headers.get("location")).toBe(`${LOGIN}/__web_login/cookie-web/login`);
    expect(entered.headers.get("cache-control")).toBe("no-store");
    expect(entered.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = entered.headers.get("set-cookie").split(";")[0];
    expect(cookie).toBe(`dd_web_login_proxy=${sess.proxyId}`);
    expect((await proxy(request(bootstrapPath))).status).toBe(403);
    upstream.mockResolvedValueOnce(new Response('<head></head><a href="/account">Account</a>', { headers: { "content-type": "text/html", "set-cookie": "session=captured; Path=/" } }));
    const first = await proxy(request("/__web_login/cookie-web/login", `${cookie}; auth_token=dashboard-secret`));
    expect(first.status).toBe(200);
    expect(first.headers.has("set-cookie")).toBe(false);
    expect(await first.text()).toContain('href="/__web_login/cookie-web/account"');
    expect(composeCookieHeader(sess)).toBe("session=captured");
    const second = await proxy(request("/__web_login/cookie-web/account?next=profile", cookie));
    expect(await second.text()).toBe("provider");
    expect(upstream.mock.calls[0][0]).toBe("https://provider.example/login");
    expect(upstream.mock.calls[0][1].headers.has("cookie")).toBe(false);
    const [url, init] = upstream.mock.calls[1];
    expect(url).toBe("https://provider.example/account?next=profile");
    expect(init.headers.get("cookie")).toBe("session=captured");
    for (const name of ["authorization", "x-api-key", "x-9r-cli-token", "x-forwarded-host"]) expect(init.headers.has(name), name).toBe(false);
    expect(guards.proxy).not.toHaveBeenCalled();
  });

  it("rejects invalid, expired and provider-mismatched bootstrap grants and expired proxy sessions", async () => {
    const createdAt = Date.UTC(2026, 0, 1);
    const clock = vi.spyOn(Date, "now").mockReturnValue(createdAt);
    const sess = session();
    // Grant lifetime starts at issuance, which can follow session creation.
    const issuedAt = createdAt + 1;
    clock.mockReturnValue(issuedAt);
    const grant = new URL(issueBootstrap(sess)).searchParams.get("grant");
    expect((await proxy(request("/__web_login/bootstrap?provider=cookie-web&grant=invalid"))).status).toBe(403);
    expect((await proxy(request(`/__web_login/bootstrap?provider=other-provider&grant=${grant}`))).status).toBe(403);
    expect((await proxy(request(`/__web_login/bootstrap?provider=cookie-web&grant=${grant}`, "", LOGIN, "POST"))).status).toBe(405);
    clock.mockReturnValue(issuedAt + 60_000);
    expect((await proxy(request(`/__web_login/bootstrap?provider=cookie-web&grant=${grant}`))).status).toBe(403);
    clock.mockReturnValue(sess.createdAt + SESSION_TTL_MS);
    expect((await proxy(request("/__web_login/cookie-web/account", proxySessionCookie(sess).split(";")[0]))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns a controlled upstream failure without reaching the dashboard", async () => {
    const cookie = proxySessionCookie(session()).split(";")[0];
    upstream.mockRejectedValueOnce(new Error("network unavailable"));
    expect((await proxy(request("/__web_login/cookie-web/login", cookie))).status).toBe(502);
    expect(guards.proxy).not.toHaveBeenCalled();
  });
});
