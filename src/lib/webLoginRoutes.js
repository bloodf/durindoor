import { NextRequest } from "next/server";
import { canAccessManagementApi, isOperatorRequest, hasExactRequestOrigin } from "@/dashboardGuard";
import { createProvider } from "./providerRouteHandlers";
import { isString } from "@/shared/utils/typeChecks";
import {
  beginSession, ownedSession, destroySession, isolatedOrigin, requestOrigin, ownerBinding,
  issueBootstrap, sessionCookie, clearedSessionCookie, capturedCookieNames, checkReady,
  composeCookieHeader, isIsolatedLoginRequest,
} from "./webLoginSession";

function json(body, status = 200, cookie) {
  const headers = { "Cache-Control": "no-store" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return Response.json(body, { status, headers });
}

/** Dashboard endpoints never accept the isolated proxy cookie as authority. */
export async function handleWebLogin(request, action) {
  if (isIsolatedLoginRequest(request)) return json({ error: "Dashboard origin required" }, 403);
  if (!(await canAccessManagementApi(request)) || !(await isOperatorRequest(request))) return json({ error: "Operator access required" }, 403);
  if (request.headers.get("origin") && !hasExactRequestOrigin(request)) return json({ error: "Cross-origin request denied" }, 403);
  const dashboardOrigin = requestOrigin(request);
  const loginOrigin = isolatedOrigin(dashboardOrigin);
  if (!loginOrigin || new URL(dashboardOrigin).hostname === new URL(loginOrigin).hostname) return json({ error: "Configure a distinct DURINDOOR_WEB_LOGIN_ORIGIN hostname" }, 503);
  let body = {};
  if (request.method !== "GET") {
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  }
  if (action === "start") {
    const sess = beginSession(body.provider, { owner: ownerBinding(request), dashboardOrigin, loginOrigin });
    if (!sess) return json({ error: "Provider does not support web login" }, 400);
    const previous = ownedSession(request);
    if (previous) destroySession(previous.id);
    return json({ pageUrl: issueBootstrap(sess) }, 200, sessionCookie(sess));
  }
  const sess = ownedSession(request);
  if (!sess) return json({ error: "Login session expired or belongs to another operator" }, 403);
  if (action === "status") return json({ provider: sess.provider, captured: capturedCookieNames(sess), ready: await checkReady(sess) });
  if (body.provider !== sess.provider) return json({ error: "Provider mismatch" }, 400);
  if (action === "popup") return json({ pageUrl: issueBootstrap(sess) });
  if (action === "cancel") {
    destroySession(sess.id);
    return json({ cancelled: true }, 200, clearedSessionCookie());
  }
  // A captured object is not authority after readiness or adapter lookup yields.
  const provider = sess.provider;
  const owner = sess.owner;
  const dashboard = sess.dashboardOrigin;
  const shouldCommit = () => ownedSession(request) === sess &&
    sess.provider === provider && body.provider === provider &&
    sess.owner === owner && sess.dashboardOrigin === dashboard && sess.loginOrigin === loginOrigin;
  const ready = await checkReady(sess);
  if (!shouldCommit()) return json({ error: "Login session expired or was cancelled or replaced" }, 409);
  if (!ready) return json({ error: "Sign-in is not ready" }, 409);
  if (!isString(body.name) || !body.name.trim()) return json({ error: "Name is required" }, 400);
  if (sess.finishing) return json({ error: "Connection save already in progress" }, 409);
  sess.finishing = true;
  try {
    const headers = new Headers(request.headers);
    headers.set("Content-Type", "application/json");
    const forwarded = new NextRequest(new URL("/api/providers", request.url), {
      method: "POST", headers,
      body: JSON.stringify({ provider: sess.provider, name: body.name.trim(), apiKey: composeCookieHeader(sess) }),
    });
    const response = await createProvider(forwarded, { shouldCommit });
    if (!response.ok) return response;
    // Persistence has already committed, but a newer login may own the browser
    // cookie while response sanitization awaits operator privilege.
    if (shouldCommit()) {
      destroySession(sess.id);
      response.headers.append("Set-Cookie", clearedSessionCookie());
    }
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally { sess.finishing = false; }
}
