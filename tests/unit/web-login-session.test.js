import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/providers/registry/index.js", () => ({ default: [
  { id: "cookie-web", webLogin: { origin: "https://provider.example", startUrl: "https://provider.example/login", allowedHosts: ["identity.example"], cookieNames: ["session"], cookiePrefixes: ["session."] } },
  { id: "probe-web", webLogin: { origin: "https://provider.example", startUrl: "https://provider.example/login", cookieNames: "*", readyProbe: { url: "https://provider.example/account", okStatus: [200, 204] } } },
] }));

import {
  beginSession, getSession, destroySession, SESSION_TTL_MS, sessionCookie, ownedSession, ownerBinding,
  issueBootstrap, consumeBootstrap, proxySessionFromRequest, proxySessionCookie,
  absorbSetCookies, cookieHeaderFor, capturedCookieNames, composeCookieHeader, checkReady,
  proxyPathFor, upstreamUrlFor, rewriteToProxy, rewriteToUpstream, proxyWebLoginRequest,
} from "../../src/lib/webLoginSession.js";

const DASHBOARD = "https://dashboard.example";
const LOGIN = "https://login.example";
let sessions;
function session(provider = "cookie-web") {
  const sess = beginSession(provider, { dashboardOrigin: DASHBOARD, loginOrigin: LOGIN });
  sessions.push(sess);
  return sess;
}
function absorb(sess, cookies, url = "https://provider.example/login") {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  absorbSetCookies(sess, new Response(null, { headers }), url);
}
function request(cookie, token = "operator-one", origin = DASHBOARD) {
  return new Request(`${origin}/api/providers/web-login/status`, { headers: { cookie, "x-9r-cli-token": token } });
}
beforeEach(() => {
  sessions = [];
  vi.stubEnv("BASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", LOGIN);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => { for (const sess of sessions) destroySession(sess.id); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("web login cookie capture", () => {
  it("absorbs replacements and enforces host, domain, path boundaries and expiry", () => {
    const sess = session();
    absorb(sess, ["host=one", "shared=two; Domain=.provider.example; Path=/", "narrow=three; Path=/account", "foreign=no; Domain=evil.example; Path=/", "short=four; Path=/; Max-Age=2"], "https://provider.example/account/login");
    expect(cookieHeaderFor(sess, "https://provider.example/account/profile")).toBe("host=one; shared=two; narrow=three; short=four");
    expect(cookieHeaderFor(sess, "https://provider.example/accounting")).toBe("shared=two; short=four");
    expect(cookieHeaderFor(sess, "https://sub.provider.example/account/profile")).toBe("shared=two");
    expect(cookieHeaderFor(sess, "https://evilprovider.example/account/profile")).toBe("");
    absorb(sess, ["shared=new; Domain=provider.example; Path=/", "narrow=gone; Path=/account; Max-Age=0", "past=gone; Path=/; Expires=Wed, 01 Jan 2020 00:00:00 GMT"]);
    vi.advanceTimersByTime(2000);
    expect(cookieHeaderFor(sess, "https://provider.example/account/profile")).toBe("host=one; shared=new");
    expect(capturedCookieNames(sess)).toEqual(["host", "shared"]);
  });

  it("requires contiguous chunks and composes ordered chunks without a stale whole cookie", async () => {
    const sess = session();
    absorb(sess, ["session=stale; Path=/", "session.1=second; Path=/", "cf_clearance=clear; Path=/", "session.3=fourth; Path=/"]);
    expect(await checkReady(sess)).toBe(false);
    absorb(sess, ["session.0=first; Path=/", "session.2=third; Path=/"]);
    expect(await checkReady(sess)).toBe(true);
    expect(composeCookieHeader(sess)).toBe("session.0=first; session.1=second; session.2=third; session.3=fourth; cf_clearance=clear");
  });

  it("probes full-header readiness using captured cookies, caches results and invalidates after capture", async () => {
    const sess = session("probe-web");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(new Response(null, { status: 204 })).mockRejectedValueOnce(new Error("offline"));
    expect(await checkReady(sess, fetcher)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    absorb(sess, ["identity=captured; Path=/"]);
    expect(await checkReady(sess, fetcher)).toBe(false);
    expect(fetcher.mock.calls[0][0]).toBe("https://provider.example/account");
    expect(fetcher.mock.calls[0][1].headers.Cookie).toBe("identity=captured");
    expect(await checkReady(sess, fetcher)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    absorb(sess, ["identity=updated; Path=/"]);
    expect(await checkReady(sess, fetcher)).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(await checkReady(sess, fetcher)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("web login session authority", () => {
  it("binds dashboard sessions to operator and origin, and expires at fifteen minutes", () => {
    const sess = session();
    sess.owner = ownerBinding(request(""));
    const cookie = sessionCookie(sess).split(";")[0];
    expect(ownedSession(request(cookie))).toBe(sess);
    expect(ownedSession(request(cookie, "another-operator"))).toBeNull();
    expect(ownedSession(request(cookie, "operator-one", "https://other.example"))).toBeNull();
    vi.advanceTimersByTime(SESSION_TTL_MS - 1);
    expect(getSession(sess.id)).toBe(sess);
    vi.advanceTimersByTime(1);
    expect(getSession(sess.id)).toBeNull();
    expect(ownedSession(request(cookie))).toBeNull();
  });

  it("rejects invalid, mismatched, expired and replayed grants while popup grants remain independent", () => {
    const sess = session();
    const first = new URL(issueBootstrap(sess)).searchParams.get("grant");
    const second = new URL(issueBootstrap(sess)).searchParams.get("grant");
    const proxyId = sess.proxyId;
    expect(first).not.toBe(second);
    expect(consumeBootstrap("invalid", sess.provider, LOGIN)).toBeNull();
    expect(consumeBootstrap(first, "probe-web", LOGIN)).toBeNull();
    expect(consumeBootstrap(first, sess.provider, "https://other.example")).toBeNull();
    expect(consumeBootstrap(first, sess.provider, LOGIN)).toBe(sess);
    expect(consumeBootstrap(first, sess.provider, LOGIN)).toBeNull();
    expect(consumeBootstrap(second, sess.provider, LOGIN)).toBe(sess);
    expect(sess.proxyId).toBe(proxyId);
    expect(proxySessionFromRequest(request(proxySessionCookie(sess).split(";")[0]))).toBe(sess);
    const expired = new URL(issueBootstrap(sess)).searchParams.get("grant");
    vi.advanceTimersByTime(60_000);
    expect(consumeBootstrap(expired, sess.provider, LOGIN)).toBeNull();
    const finalGrant = new URL(issueBootstrap(sess)).searchParams.get("grant");
    vi.advanceTimersByTime(SESSION_TTL_MS);
    expect(consumeBootstrap(finalGrant, sess.provider, LOGIN)).toBeNull();
    expect(proxySessionFromRequest(request(proxySessionCookie(sess).split(";")[0]))).toBeNull();
  });
});

describe("web login upstream translation", () => {
  it("maps only allowlisted provider hosts and rewrites plain, escaped and encoded URLs both ways", () => {
    const sess = session();
    const base = `${LOGIN}/__web_login/cookie-web`;
    const original = 'https://provider.example/a https:\\/\\/identity.example\\/b https%3A%2F%2Fprovider.example%2Fc https://provider.example.evil.example/x';
    const translated = rewriteToProxy(original, sess, LOGIN);
    expect(translated).toContain(`${base}/a`);
    expect(translated).toContain(`${LOGIN}/__web_login/cookie-web/__host/identity.example`.replaceAll("/", "\\/"));
    expect(translated).toContain(encodeURIComponent(base));
    expect(translated).toContain("https://provider.example.evil.example/x");
    expect(rewriteToUpstream(translated, sess, LOGIN)).toBe(original);
    expect(proxyPathFor(sess, "https://identity.example/auth?x=1#step")).toBe("/__web_login/cookie-web/__host/identity.example/auth?x=1#step");
    expect(upstreamUrlFor(sess, "/__web_login/cookie-web/__host/identity.example/auth", "?x=1")).toBe("https://identity.example/auth?x=1");
    for (const path of ["/api/providers", "/__web_login/probe-web/login", "/__web_login/cookie-web/__host/evil.example/auth"]) expect(upstreamUrlFor(sess, path)).toBeNull();
    expect(proxyPathFor(sess, "https://evil.example/auth")).toBeNull();
  });

  it("forwards only jar cookies, strips secrets, translates requests and absorbs response cookies", async () => {
    const sess = session();
    absorb(sess, ["session=jar-only; Path=/"]);
    const fetcher = vi.fn(async () => new Response('<head></head><a href="/account">Account</a>', { headers: {
      "content-type": "text/html", "set-cookie": "extra=captured; Path=/", location: "/account", "x-frame-options": "DENY", "clear-site-data": '"*"', "content-security-policy": "default-src 'none'", "access-control-allow-origin": "*",
    } }));
    const req = new Request(`${LOGIN}/__web_login/cookie-web/login`, { method: "POST", headers: {
      cookie: "auth_token=dashboard-secret", authorization: "Bearer dashboard-secret", "proxy-authorization": "secret", "x-api-key": "secret", "x-goog-api-key": "secret", "x-9r-cli-token": "secret", "x-forwarded-host": "dashboard.example", "x-middleware-test": "secret", origin: LOGIN, referer: `${LOGIN}/__web_login/cookie-web/login`, "content-type": "application/json", "sec-fetch-dest": "iframe",
    }, body: JSON.stringify({ callback: `${LOGIN}/__web_login/cookie-web/account` }) });
    const out = await proxyWebLoginRequest(sess, req, "https://provider.example/login", LOGIN, fetcher);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://provider.example/login");
    expect(init.headers.get("cookie")).toBe("session=jar-only");
    for (const name of ["authorization", "proxy-authorization", "x-api-key", "x-goog-api-key", "x-9r-cli-token", "x-forwarded-host", "x-middleware-test"]) expect(init.headers.has(name), name).toBe(false);
    expect(init.headers.get("origin")).toBe("https://provider.example");
    expect(init.headers.get("referer")).toBe("https://provider.example/login");
    expect(init.headers.get("sec-fetch-dest")).toBe("document");
    expect(JSON.parse(init.body.toString())).toEqual({ callback: "https://provider.example/account" });
    expect(composeCookieHeader(sess)).toBe("session=jar-only; extra=captured");
    for (const name of ["set-cookie", "x-frame-options", "clear-site-data", "content-security-policy", "access-control-allow-origin"]) expect(out.headers.has(name), name).toBe(false);
    expect(out.headers.get("location")).toBe("/__web_login/cookie-web/account");
    expect(out.headers.get("cache-control")).toBe("no-store");
    expect(await out.text()).toContain('href="/__web_login/cookie-web/account"');
  });
});
