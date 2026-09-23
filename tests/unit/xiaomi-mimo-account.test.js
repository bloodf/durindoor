// port(upstream): #4245 - Desktop ServiceTokenManager handshake and account clusters (910db74).
import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

const proxyAwareFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

import {
  getMimoAccountCookie,
  getMimoAccountUsage,
  invalidateMimoAccountCookieCache,
  resolveMimoServerBase,
  __test__,
} from "../../open-sse/shared/mimoAccount.js";

// > 2^53: JSON.parse would round it, so signing must use the raw literal.
const NONCE = "1234567890123456789";
const SSECURITY = "sec==";

function phase1(body) {
  return new Response(`&&&START&&&${body}`, { status: 200 });
}
function phase2Redirect(location, setCookie) {
  const headers = new Headers({ location });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(null, { status: 302, headers });
}
function phase2Done(setCookies) {
  const headers = new Headers();
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response("ok", { status: 200, headers });
}

function stubHandshake() {
  proxyAwareFetch
    .mockResolvedValueOnce(phase1(`{"code":0,"location":"https://sts.example/cb?x=1","ssecurity":"${SSECURITY}","nonce":${NONCE}}`))
    .mockResolvedValueOnce(phase2Redirect("/cb2", "junk=1; Path=/"))
    .mockResolvedValueOnce(phase2Done(["serviceToken=tok; Path=/", "mimopc_ph=ph; Path=/", "other=zzz; Path=/"]));
}

describe("mimoAccount", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    invalidateMimoAccountCookieCache();
  });

  it("maps the five clusters to their host and sid, unknown falls back to sgp", () => {
    expect(resolveMimoServerBase({ region: "cn" })).toBe("https://mimo-server-cn.xiaomimimo.com");
    expect(resolveMimoServerBase({ region: "AMS" })).toBe("https://mimo-server-ams.xiaomimimo.com");
    expect(resolveMimoServerBase(null)).toBe("https://mimo-server-sgp.xiaomimimo.com");
    expect(["cn", "sgp", "ams", "ru", "in", "eu"].map(__test__.sidForRegion))
      .toEqual(["mimopc", "mimosgp", "mimoams", "mimoru", "mimoin", "mimosgp"]);
  });

  it("runs the two-phase handshake with the cluster sid and the raw nonce", async () => {
    stubHandshake();
    const proxy = { enabled: true, url: "http://127.0.0.1:7890" };
    const cookie = await getMimoAccountCookie({ region: "ams", mimoPassToken: "pt", mimoUserId: "42" }, proxy);

    expect(cookie).toBe("userId=42; serviceToken=tok; mimopc_ph=ph");
    const [p1Url, p1Init, p1Proxy] = proxyAwareFetch.mock.calls[0];
    expect(p1Url).toContain("sid=mimoams");
    expect(p1Init.headers.Cookie).toBe("userId=42; passToken=pt");
    expect(p1Proxy).toBe(proxy);

    const expectedSign = encodeURIComponent(crypto.createHash("sha1").update(`nonce=${NONCE}&${SSECURITY}`).digest("base64"));
    const [p2Url, p2Init] = proxyAwareFetch.mock.calls[1];
    expect(p2Url).toBe(`https://sts.example/cb?x=1&clientSign=${expectedSign}`);
    // Phase 2 must not carry the account cookies.
    expect(p2Init.headers.Cookie).toBeUndefined();
    expect(proxyAwareFetch.mock.calls[2][0]).toBe("https://sts.example/cb2");
  });

  it("always goes direct for the CN cluster", async () => {
    stubHandshake();
    await getMimoAccountCookie({ region: "cn", mimoPassToken: "pt" }, { enabled: true, url: "http://proxy" });
    expect(proxyAwareFetch.mock.calls.every((call) => call[2] === null)).toBe(true);
  });

  it("caches one session per passToken and cluster", async () => {
    stubHandshake();
    await getMimoAccountCookie({ region: "sgp", mimoPassToken: "pt" });
    await getMimoAccountCookie({ region: "sgp", mimoPassToken: "pt" });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("returns null when phase 1 reports an error code", async () => {
    proxyAwareFetch.mockResolvedValueOnce(phase1(`{"code":70016,"desc":"login required"}`));
    expect(await getMimoAccountCookie({ region: "sgp", mimoPassToken: "bad" })).toBeNull();
  });

  it("reads the weekly quota from the connection's cluster", async () => {
    stubHandshake();
    proxyAwareFetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { percent: 80, resetDate: "2026-09-30" } }), { status: 200 }));
    const usage = await getMimoAccountUsage({ region: "ru", mimoPassToken: "pt" });
    expect(usage).toEqual({ percent: 80, resetDate: "2026-09-30", resetAt: undefined });
    expect(proxyAwareFetch.mock.calls[3][0]).toBe("https://mimo-server-ru.xiaomimimo.com/api/user/usage");
  });
});
