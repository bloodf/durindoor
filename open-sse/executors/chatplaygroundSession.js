/** Current web protocol only; no endpoint discovery, retries, or shared token cache. */
import { isFunction, isString } from "../../src/shared/utils/typeChecks.js";

export const CHATPLAYGROUND_API = "https://web.chatplayground.ai/api";
const WEB = "https://web.chatplayground.ai";
const CLERK = "https://clerk.chatplayground.ai";
const QUERY = "?__clerk_api_version=2026-08-20&_clerk_js_version=6.43.0";
const failure = (status = 502, reason = "session_rejected") => ({ ok: false, status, reason });
export function chatPlaygroundCredential(credentials = {}) {
  return credentials.apiKey || credentials.cookie || credentials.accessToken ||
    credentials.providerSpecificData?.cookie || credentials.providerSpecificData?.jwt || "";
}
function payload(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); }
  catch { return null; }
}

/** A deadline also bounds transports/readers that ignore AbortSignal. Never expose upstream errors. */
export async function withChatPlaygroundSessionDeadline(work, { signal, timeoutMs = 10000 } = {}) {
  // Return before creating a rejecting deadline promise on the pre-aborted path.
  if (signal?.aborted) return failure(408, "session_aborted");
  const controller = new AbortController();
  let timer;
  let onAbort;
  const stopped = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(new Error("session_aborted")); };
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(onAbort, Math.max(1, Math.min(timeoutMs || 10000, 10000)));
  });
  try {
    return await Promise.race([work(controller.signal), stopped]);
  } catch { return failure(controller.signal.aborted ? 408 : 502, controller.signal.aborted ? "session_aborted" : "session_transport_failed"); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); controller.abort(); }
}

/** Bounded JSON, with no HTML/challenge interpretation or upstream body in diagnostics. */
export async function readChatPlaygroundJson(response, signal) {
  if (response.headers.get("content-type")?.includes("text/html")) throw new Error("unsupported_response");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("unsupported_response");
  let size = 0;
  const chunks = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new Error("session_aborted");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) throw new Error("unsupported_response");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { cancel(); signal?.removeEventListener("abort", cancel); }
}

/** Acquire once per operation. Cookie is sent only to Clerk; expiry is capped at 60 seconds.
 * Opaque tokens remain compatible with the existing chat contract; explicit JWT expiry is enforced.
 * fetcher MUST be bound to the selected connection's proxy; no ambient credentials are used.
 */
export async function acquireChatPlaygroundSession(raw, fetcher, options = {}) {
  return withChatPlaygroundSessionDeadline(async (signal) => {
    const input = String(raw || "").replace(/^Cookie:\s*/i, "").replace(/^Bearer\s+/i, "").trim();
    const cookies = Object.fromEntries(input.split(";").map((part) => {
      const i = part.indexOf("=");
      return i < 0 ? ["", ""] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
    }));
    let token;
    if (input.startsWith("eyJ") && input.split(".").length === 3) token = input;
    else {
      const sid = payload(cookies.__session || "")?.sid;
      if (!cookies.__client || /[\r\n]/.test(cookies.__client) || !isString(sid) || !/^[\w-]{1,256}$/.test(sid)) return failure(401);
      const response = await fetcher(`${CLERK}/v1/client/sessions/${encodeURIComponent(sid)}/tokens${QUERY}`, {
        method: "POST", redirect: "manual", credentials: "omit", signal,
        headers: { accept: "*/*", "content-type": "application/x-www-form-urlencoded", origin: WEB, referer: `${WEB}/`, cookie: `__client=${cookies.__client}` },
        body: "organization_id=&tab_state=visible&token=",
      });
      if (!response.ok) { void response.body?.cancel().catch(() => {}); return failure(response.status); }
      token = (await readChatPlaygroundJson(response, signal)).jwt;
    }
    if (!isString(token) || !token || token.length > 16384 || /[\s;=]/.test(token) || token.includes("__client") || token.includes("__session") || token === cookies.__client || token === cookies.__session) return failure(502);
    if (signal.aborted) return failure(408, "session_aborted");
    const exp = payload(token)?.exp;
    const now = Date.now();
    if (exp !== undefined && (!Number.isFinite(exp) || exp * 1000 <= now + 1000)) return failure(401, "session_expired");
    return { ok: true, headers: { Authorization: `Bearer ${token}` }, expiresAt: Math.min(now + 60000, exp === undefined ? Infinity : exp * 1000) };
  }, options);
}

/** Nonbillable selected-connection readiness/discovery. No chat, retries, or credential fallback.
 * The nonempty string `id` guard is unverified, not a source-backed /me field contract.
 * Unknown shapes must be classified as unsupported/unverified, never invalid credentials.
 */
export async function inspectChatPlaygroundConnection(credentials, fetcher, options = {}) {
  return withChatPlaygroundSessionDeadline(async (signal) => {
    if (!isFunction(fetcher)) return failure(400, "selected_connection_transport_required");
    const auth = await acquireChatPlaygroundSession(chatPlaygroundCredential(credentials), fetcher, { signal });
    if (!auth.ok) return auth;
    if (signal.aborted) return failure(408, "session_aborted");
    const headers = { Accept: "application/json", Origin: WEB, Referer: `${WEB}/`, ...auth.headers };
    const me = await fetcher(`${CHATPLAYGROUND_API}/me`, { method: "GET", redirect: "manual", credentials: "omit", headers, signal });
    if (!me.ok) { void me.body?.cancel().catch(() => {}); return failure(me.status); }
    const identity = await readChatPlaygroundJson(me, signal);
    if (!isString(identity?.id) || !identity.id.trim()) return failure(502, "unsupported_me_identity_shape");
    if (signal.aborted) return failure(408, "session_aborted");
    if (!options.discovery) return { ok: true, valid: true, status: 200 };
    const response = await fetcher(`${CHATPLAYGROUND_API}/models`, { method: "GET", redirect: "manual", credentials: "omit", headers: { Accept: "application/json", Origin: WEB, Referer: `${WEB}/` }, signal });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); return failure(response.status); }
    const catalog = await readChatPlaygroundJson(response, signal);
    const rows = Array.isArray(catalog) ? catalog : catalog?.data || catalog?.models;
    if (!Array.isArray(rows)) return failure(502, "unsupported_catalog_shape");
    return { ok: true, valid: true, status: 200, catalog };
  }, options);
}
