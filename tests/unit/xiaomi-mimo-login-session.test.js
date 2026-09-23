// port(upstream): #4245 - server-assisted Xiaomi MiMo login proxy (910db74).
import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  beginSession,
  encodeSessionCookie,
  decodeSessionCookie,
  sessionFromRequest,
  absorbSetCookies,
  readSessionIdentity,
  isAccountProxyPath,
  isMimoTakeoverPath,
  takeoverUpstreamPath,
  rewriteMimoBases,
  __test__,
} from "../../src/lib/mimoLoginSession.js";

const { STRIP_UPSTREAM_HEADERS, buildBrowserResponse } = __test__;
const ORIGIN = "http://localhost:20128";

describe("mimo login session cookie", () => {
  it("round-trips region and jar, and normalizes unknown regions to sgp", () => {
    const sess = beginSession("AMS");
    absorbSetCookies(sess, new Response(null, { headers: { "set-cookie": "passToken=pt; Domain=.account.xiaomi.com; Path=/" } }), "https://account.xiaomi.com/pass/login");
    const back = decodeSessionCookie(encodeSessionCookie(sess));
    expect(back.region).toBe("ams");
    expect(back.upstreamBase).toBe("https://mimo-server-ams.xiaomimimo.com");
    expect(readSessionIdentity(back)).toEqual({ passToken: "pt", userId: null, cUserId: null });
    expect(beginSession("eu").region).toBe("sgp");
  });

  it("rejects garbage and expired cookies", () => {
    expect(decodeSessionCookie("nope")).toBeNull();
    const sess = beginSession("cn");
    sess.createdAt = Date.now() - 16 * 60 * 1000;
    expect(decodeSessionCookie(encodeSessionCookie(sess))).toBeNull();
  });

  it("reads the session from the request cookie", () => {
    const sess = beginSession("sgp");
    const req = new Request(`${ORIGIN}/fe/service/login`, { headers: { cookie: `a=b; ${SESSION_COOKIE}=${encodeSessionCookie(sess)}` } });
    expect(sessionFromRequest(req).state).toBe(sess.state);
  });

  it("drops expired Set-Cookie values from the jar", () => {
    const sess = beginSession("cn");
    const url = "https://account.xiaomi.com/pass/x";
    absorbSetCookies(sess, new Response(null, { headers: { "set-cookie": "passToken=pt; Path=/" } }), url);
    absorbSetCookies(sess, new Response(null, { headers: { "set-cookie": "passToken=EXPIRED; Path=/" } }), url);
    expect(readSessionIdentity(sess)).toBeNull();
  });
});

describe("mimo login proxy routing", () => {
  it("never proxies the app's own paths", () => {
    for (const p of ["/", "/dashboard/providers", "/api/oauth/xiaomi-mimo/login/status", "/v1/chat/completions", "/v1", "/login", "/_next/x.js", "/codex/responses", "/favicon.svg"]) {
      expect(isAccountProxyPath(p), p).toBe(false);
    }
    for (const p of ["/fe/service/login", "/pass/serviceLoginAuth2", "/pass2/config"]) {
      expect(isAccountProxyPath(p), p).toBe(true);
    }
  });

  it("maps the takeover space back to the mimo-server path", () => {
    expect(isMimoTakeoverPath("/__mimo_login/mimo/api/sts")).toBe(true);
    expect(takeoverUpstreamPath("/__mimo_login/mimo/api/sts")).toBe("/api/sts");
  });

  it("rewrites mimo-server and account URLs into our origin and back", () => {
    const text = "cb=https%3A%2F%2Fmimo-server-in.xiaomimimo.com%2Fapi%2Fsts&go=https://account.xiaomi.com/fe";
    const proxied = rewriteMimoBases(text, "toProxy", ORIGIN);
    expect(proxied).toContain(encodeURIComponent(`${ORIGIN}/__mimo_login/mimo/api/sts`));
    expect(proxied).toContain(`${ORIGIN}/fe`);
    expect(rewriteMimoBases(proxied, "toUpstream", ORIGIN, "https://mimo-server-in.xiaomimimo.com")).toBe(text);
  });
});

describe("mimo login proxy security", () => {
  it("never forwards DurinDoor credentials or browser cookies upstream", () => {
    for (const h of ["authorization", "proxy-authorization", "cookie", "host"]) {
      expect(STRIP_UPSTREAM_HEADERS.has(h)).toBe(true);
    }
  });

  it("does not replay upstream Set-Cookie onto the app origin and drops frame blockers", async () => {
    const upstream = new Response("ok", {
      status: 200,
      headers: { "content-type": "text/html", "set-cookie": "userId=123; Path=/", "x-frame-options": "DENY" },
    });
    const out = await buildBrowserResponse({ jar: new Map() }, upstream, ORIGIN, "/pass/");
    expect(out.headers.getSetCookie()).toEqual([]);
    expect(out.headers.get("x-frame-options")).toBeNull();
    expect(out.headers.get("content-type")).toBe("text/html");
  });
});
