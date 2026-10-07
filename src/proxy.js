import { proxy as dashboardProxy, canAccessManagementApi } from "./dashboardGuard";
import {
  SESSION_COOKIE,
  sessionFromRequest,
  isAccountProxyPath,
  isMimoTakeoverPath,
  takeoverUpstreamPath,
  proxyAccountRequest,
  runTakeover,
  attachSessionCookie,
  clearedSessionCookie,
  originOf,
} from "./lib/mimoLoginSession";
import {
  isolatedOrigin, requestOrigin, isIsolatedLoginRequest, consumeBootstrap, proxySessionFromRequest,
  proxySessionCookie, proxyPathFor, upstreamUrlFor, proxyWebLoginRequest,
} from "./lib/webLoginSession";

async function webLoginProxy(request, loginOrigin) {
  const url = request.nextUrl || new URL(request.url);
  if (url.pathname === "/__web_login/bootstrap") {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const sess = consumeBootstrap(url.searchParams.get("grant"), url.searchParams.get("provider"), loginOrigin);
    if (!sess || sess.loginOrigin !== loginOrigin) return new Response("Invalid login grant", { status: 403 });
    // Next's middleware adapter reconstructs Location without a base URL.
    return new Response(null, { status: 303, headers: {
      Location: new URL(proxyPathFor(sess, sess.config.startUrl), loginOrigin).href,
      "Set-Cookie": proxySessionCookie(sess), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    } });
  }
  const sess = proxySessionFromRequest(request);
  const upstream = sess && sess.loginOrigin === loginOrigin && upstreamUrlFor(sess, url.pathname, url.search);
  if (!upstream) return new Response("Not found", { status: 404 });
  try { return await proxyWebLoginRequest(sess, request, upstream, loginOrigin); }
  catch { return new Response("Web login upstream unavailable", { status: 502 }); }
}

async function withClearedMimoSession(request) {
  const res = await dashboardProxy(request);
  const headers = new Headers(res.headers);
  headers.append("Set-Cookie", clearedSessionCookie());
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Xiaomi MiMo browser login (src/lib/mimoLoginSession.js).
 *
 * While the dd_mimo_login cookie is present, non-app paths are reverse-proxied
 * to account.xiaomi.com so the real login page runs on our origin and its
 * Set-Cookie lands in a server-side jar. The cookie is set only by the
 * auth-gated /api/oauth/xiaomi-mimo/login/start route, and this branch also
 * requires management access: the cookie is client-controlled and unsigned, so
 * a forged one must never turn the app into an unauthenticated forwarder.
 * A cookie without that access, or one that no longer decodes, is cleared.
 */
async function mimoLoginProxy(request) {
  const sess = sessionFromRequest(request);
  if (!sess || !(await canAccessManagementApi(request))) return withClearedMimoSession(request);

  const { pathname, search } = request.nextUrl;
  const origin = originOf(request);
  try {
    if (isMimoTakeoverPath(pathname)) {
      const upstreamUrl = `${sess.upstreamBase}${takeoverUpstreamPath(pathname)}${search || ""}`;
      return attachSessionCookie(await runTakeover(sess, upstreamUrl, origin), sess);
    }
    if (isAccountProxyPath(pathname)) {
      return attachSessionCookie(await proxyAccountRequest(sess, request, origin), sess);
    }
  } catch (e) {
    console.log("[mimo-login] proxy error:", e?.message || e);
    return new Response("mimo login proxy error", { status: 502 });
  }
  return dashboardProxy(request);
}

export default async function proxy(request) {
  const loginOrigin = isolatedOrigin();
  if (isIsolatedLoginRequest(request)) {
    if (!loginOrigin || requestOrigin(request) !== loginOrigin) return new Response("Not found", { status: 404 });
    return webLoginProxy(request, loginOrigin);
  }
  if (request.nextUrl.pathname.startsWith("/__web_login/")) return new Response("Not found", { status: 404 });
  if (request.cookies?.get?.(SESSION_COOKIE)) return mimoLoginProxy(request);
  return dashboardProxy(request);
}

export const config = {
  matcher: ["/:path*"],
};
