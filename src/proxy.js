import { NextResponse } from "next/server";
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

// Normalize static prefixes and the known terminal leaves after file/batch IDs.
// Dynamic IDs and catch-all tails must reach Next in their original encoding.
const API_STATIC_PATHS = [
  "chat/completions", "chatgpt-web/image", "responses/compact", "responses",
  "messages/count_tokens", "messages/batches", "messages", "files", "batches",
  "audio/music", "audio/speech", "audio/transcriptions", "audio/translations", "audio/voices",
  "images/edits", "images/generations", "music/generations", "video/generations", "videos",
  "realtime/translations/client_secrets", "realtime/auth", "realtime/client_secrets",
  "realtime/native", "realtime/transcription_sessions", "live/sessions",
  "models/info", "models", "native", "web/fetch", "search", "systemone", "rerank",
  "moderations", "completions", "embeddings", "provider-plugin-manifest", "api/chat",
].map((path) => path.split("/"));

function staticSegment(segment) {
  // Decode only single-encoded ASCII token characters, never %, dots or separators.
  return segment?.replace(/%([0-9a-f]{2})/gi, (escape, hex) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[a-z0-9_-]$/i.test(character) ? character : escape;
  });
}

async function guardedApiDispatch(request) {
  const response = await dashboardProxy(request);
  if (response.headers.get("x-middleware-next") !== "1") return response;

  const pathname = request.nextUrl.pathname;
  if (!pathname.includes("%")) return response;
  const segments = pathname.split("/");
  let offset = 1;
  let root = staticSegment(segments[offset]);
  if (root === "api") root = staticSegment(segments[++offset]);
  if (!["v1", "v1beta", "responses", "codex"].includes(root)) return response;

  // Fail closed before URL construction could normalize an ambiguous path.
  // Dynamic escapes remain byte-for-byte intact; they are never decoded here.
  if (/%(?![0-9a-f]{2})|%2f|%5c|\\/i.test(pathname) ||
      segments.some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))) {
    const headers = new Headers(response.headers);
    headers.delete("x-middleware-next");
    return NextResponse.json({ error: "Invalid API path" }, { status: 400, headers });
  }

  let destination;
  if (offset === 1 && (root === "responses" || root === "codex")) {
    if (root === "responses" && segments.length !== 2) return response;
    destination = "/api/v1/responses";
  } else {
    if (root !== "v1" && root !== "v1beta") return response;
    offset++;
    if (root === "v1" && offset === 2 && staticSegment(segments[offset]) === "v1") offset++;
    const paths = root === "v1beta" ? [["models"]] : API_STATIC_PATHS;
    const prefix = paths.find((parts) => parts.every((part, index) => staticSegment(segments[offset + index]) === part));
    // Unknown routes stay unknown; never decode a catch-all into a static route.
    if (!prefix) return response;
    const route = prefix.join("/");
    const idIndex = offset + prefix.length;
    const leafIndex = idIndex + 1;
    if (root === "v1" && segments[idIndex] && segments.length === leafIndex + 1) {
      const leaf = staticSegment(segments[leafIndex]);
      if ((route === "files" && leaf === "content") ||
          (route === "batches" && leaf === "cancel") ||
          (route === "messages/batches" && (leaf === "cancel" || leaf === "results"))) {
        segments[leafIndex] = leaf;
      }
    }
    destination = `/api/${root}/${route}${segments.slice(idIndex).map((part) => `/${part}`).join("")}`;
  }
  if (destination === pathname) return response;
  const url = new URL(request.url);
  url.pathname = destination;
  const headers = new Headers(response.headers);
  headers.delete("x-middleware-next");
  // Internal rewrite retains the original method, headers and unread body. Do
  // not rebuild searchParams: query order, duplicate keys and escapes matter.
  return NextResponse.rewrite(url, { headers });
}

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
  const res = await guardedApiDispatch(request);
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
  return guardedApiDispatch(request);
}

export default async function proxy(request) {
  const loginOrigin = isolatedOrigin();
  if (isIsolatedLoginRequest(request)) {
    if (!loginOrigin || requestOrigin(request) !== loginOrigin) return new Response("Not found", { status: 404 });
    return webLoginProxy(request, loginOrigin);
  }
  if (request.nextUrl.pathname.startsWith("/__web_login/")) return new Response("Not found", { status: 404 });
  const pathname = request.nextUrl.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    const canonical = new URL(request.url);
    canonical.pathname = pathname.slice(0, -1);
    return new Response(null, { status: 308, headers: { Location: canonical.href } });
  }
  if (request.cookies?.get?.(SESSION_COOKIE)) return mimoLoginProxy(request);
  return guardedApiDispatch(request);
}

export const config = {
  matcher: ["/:path*"],
};
