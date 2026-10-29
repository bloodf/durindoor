import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const guards = vi.hoisted(() => ({ canAccessManagementApi: vi.fn(), isOperatorRequest: vi.fn(), hasExactRequestOrigin: vi.fn() }));
const models = vi.hoisted(() => ({
  createProviderConnection: vi.fn(), getProviderConnections: vi.fn(), getProviderNodeById: vi.fn(),
  getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));
vi.mock("@/dashboardGuard", () => guards);
vi.mock("@/models", () => models);
vi.mock("open-sse/providers/registry/index.js", () => ({ default: [
  { id: "cookie-web", alias: "cookie-web", category: "webCookie", authType: "cookie", display: { name: "Cookie Web" }, webLogin: { origin: "https://provider.example", startUrl: "https://provider.example/login", cookieNames: ["session"], cookiePrefixes: ["session."] } },
] }));

import { POST as start } from "../../../src/app/api/providers/web-login/start/route.js";
import { GET as status } from "../../../src/app/api/providers/web-login/status/route.js";
import { POST as finish } from "../../../src/app/api/providers/web-login/finish/route.js";
import { POST as cancel } from "../../../src/app/api/providers/web-login/cancel/route.js";
import { POST as popup } from "../../../src/app/api/providers/web-login/popup/route.js";
import { sessionFromRequest, absorbSetCookies, destroySession, consumeBootstrap, SESSION_TTL_MS } from "../../../src/lib/webLoginSession.js";

const DASHBOARD = "https://dashboard.example";
const LOGIN = "https://login.example";
let sessions;
function request(action, body = {}, cookie = "", token = "operator-one", origin = DASHBOARD) {
  return new NextRequest(`${DASHBOARD}/api/providers/web-login/${action}`, {
    method: action === "status" ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-9r-cli-token": token, origin, cookie },
    ...(action === "status" ? {} : { body: JSON.stringify(body) }),
  });
}
async function begin() {
  const res = await start(request("start", { provider: "cookie-web" }));
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const sess = sessionFromRequest(request("status", {}, cookie));
  sessions.push(sess);
  return { res, cookie, sess };
}
function capture(sess) {
  const headers = new Headers();
  for (const value of ["session=stale; Path=/", "session.1=second; Path=/", "cf_clearance=clear; Path=/", "session.0=first; Path=/"]) headers.append("Set-Cookie", value);
  absorbSetCookies(sess, new Response(null, { headers }), "https://provider.example/login");
}
beforeEach(() => {
  sessions = [];
  vi.clearAllMocks();
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", LOGIN);
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  guards.canAccessManagementApi.mockResolvedValue(true);
  guards.isOperatorRequest.mockResolvedValue(true);
  guards.hasExactRequestOrigin.mockReturnValue(true);
  models.createProviderConnection.mockReset();
});
afterEach(() => { for (const sess of sessions) destroySession(sess.id); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("provider web-login API authority", () => {
  it("requires management and operator access before creating a session", async () => {
    guards.canAccessManagementApi.mockResolvedValue(false);
    expect((await start(request("start", { provider: "cookie-web" }))).status).toBe(403);
    guards.canAccessManagementApi.mockResolvedValue(true);
    guards.isOperatorRequest.mockResolvedValue(false);
    expect((await start(request("start", { provider: "cookie-web" }))).status).toBe(403);
    expect(models.createProviderConnection).not.toHaveBeenCalled();
  });

  it("rejects cross-origin mutations and disabled or same-host proxy configuration", async () => {
    guards.hasExactRequestOrigin.mockReturnValue(false);
    expect((await start(request("start", { provider: "cookie-web" }, "", "operator-one", "https://foreign.example"))).status).toBe(403);
    guards.hasExactRequestOrigin.mockReturnValue(true);
    for (const [origin, expectedStatus] of [["", 503], [DASHBOARD, 403], ["https://dashboard.example:9443", 403], ["https://user:pass@login.example", 503], ["https://login.example/path", 503]]) {
      vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", origin);
      expect((await start(request("start", { provider: "cookie-web" }))).status, origin).toBe(expectedStatus);
    }
    expect(models.createProviderConnection).not.toHaveBeenCalled();
  });

  it("denies direct isolated-host API calls before dashboard auth can grant authority", async () => {
    const req = new NextRequest(`${LOGIN}/api/providers/web-login/start`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer forged-auth", "x-9r-cli-token": "forged-token", origin: LOGIN },
      body: JSON.stringify({ provider: "cookie-web" }),
    });
    expect((await start(req)).status).toBe(403);
    expect(guards.canAccessManagementApi).not.toHaveBeenCalled();
    expect(guards.isOperatorRequest).not.toHaveBeenCalled();
    expect(models.createProviderConnection).not.toHaveBeenCalled();
  });

  it("rejects unsupported providers, missing sessions, wrong owners and provider mismatch", async () => {
    expect((await start(request("start", { provider: "unsupported" }))).status).toBe(400);
    expect((await status(request("status"))).status).toBe(403);
    const { cookie, sess } = await begin();
    expect((await status(request("status", {}, cookie, "operator-two"))).status).toBe(403);
    expect((await finish(request("finish", { provider: "other", name: "Account" }, cookie))).status).toBe(400);
    expect((await cancel(request("cancel", { provider: "other" }, cookie))).status).toBe(400);
    sess.createdAt = Date.now() - SESSION_TTL_MS;
    expect((await status(request("status", {}, cookie))).status).toBe(403);
    expect(models.createProviderConnection).not.toHaveBeenCalled();
  });
});

describe("provider web-login API lifecycle", () => {
  it("starts, reports capture readiness and rejects missing names before creation", async () => {
    const { res, cookie, sess } = await begin();
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const pageUrl = (await res.json()).pageUrl;
    expect(new URL(pageUrl).origin).toBe(LOGIN);
    expect(await (await status(request("status", {}, cookie))).json()).toEqual({ provider: "cookie-web", captured: [], ready: false });
    expect((await finish(request("finish", { provider: "cookie-web", name: "Account" }, cookie))).status).toBe(409);
    capture(sess);
    expect(await (await status(request("status", {}, cookie))).json()).toEqual({ provider: "cookie-web", captured: ["cf_clearance", "session", "session.0", "session.1"], ready: true });
    expect((await finish(request("finish", { provider: "cookie-web", name: "  " }, cookie))).status).toBe(400);
    expect(models.createProviderConnection).not.toHaveBeenCalled();
  });

  it("issues independent popup grants without rotating proxy authority, and cancel invalidates all authority", async () => {
    const { res, cookie, sess } = await begin();
    const first = new URL((await res.json()).pageUrl);
    const popupRes = await popup(request("popup", { provider: "cookie-web" }, cookie));
    expect(popupRes.status).toBe(200);
    const second = new URL((await popupRes.json()).pageUrl);
    expect(first.searchParams.get("grant")).not.toBe(second.searchParams.get("grant"));
    const proxyId = sess.proxyId;
    expect(consumeBootstrap(first.searchParams.get("grant"), "cookie-web", LOGIN)).toBe(sess);
    expect(consumeBootstrap(second.searchParams.get("grant"), "cookie-web", LOGIN)).toBe(sess);
    expect(sess.proxyId).toBe(proxyId);
    const pending = new URL((await (await popup(request("popup", { provider: "cookie-web" }, cookie))).json()).pageUrl);
    const cancelled = await cancel(request("cancel", { provider: "cookie-web" }, cookie));
    expect(await cancelled.json()).toEqual({ cancelled: true });
    expect(cancelled.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await status(request("status", {}, cookie))).status).toBe(403);
    expect(consumeBootstrap(pending.searchParams.get("grant"), "cookie-web", LOGIN)).toBeNull();
  });
});
