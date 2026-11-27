import { isString, isNumber } from "../../../shared/utils/typeChecks.js";
import { randomUUID } from "node:crypto";
import { readBoundedResponseText } from "../../../../open-sse/utils/error.js";
import { generatePKCE } from "../utils/pkce.js";

const sessions = new Map();
const TTL = 15 * 60 * 1000;

/** Start a short-lived login; the PKCE verifier remains in this process. */
export function createCursorLoginSession() {
  for (const [id, session] of sessions) if (session.expiresAt <= Date.now()) sessions.delete(id);
  if (sessions.size >= 10000) sessions.delete(sessions.keys().next().value);
  const { codeVerifier, codeChallenge } = generatePKCE();
  const uuid = randomUUID();
  const sessionId = randomUUID();
  const query = new URLSearchParams({ challenge: codeChallenge, uuid, mode: "login", redirectTarget: "cli" });
  sessions.set(sessionId, { verifier: codeVerifier, uuid, expiresAt: Date.now() + TTL, polling: false });
  return { sessionId, loginUrl: `https://cursor.com/loginDeepControl?${query}`, expiresInSeconds: TTL / 1000 };
}

export function cancelCursorLoginSession(id) { return sessions.delete(id); }

/**
 * Serialize polls so a successful verifier cannot be persisted twice.
 * `options.signal` lets a caller abandon one poll; the session stays usable.
 */
export async function pollCursorLoginSession(id, { signal: callerSignal } = {}) {
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) { sessions.delete(id); return { status: "expired" }; }
  if (callerSignal?.aborted) return { status: "error" };
  if (session.polling) return { status: "pending" };
  session.polling = true;
  try {
    const query = new URLSearchParams({ uuid: session.uuid, verifier: session.verifier });
    const timeout = AbortSignal.timeout(15000);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    const response = await fetch(`https://api2.cursor.sh/auth/poll?${query}`, { redirect: "error", signal });
    if (!response.ok) void response.body?.cancel().catch(() => {});
    if (response.status === 404) return { status: "pending" };
    if (!response.ok) return { status: "error", httpStatus: response.status };
    const data = JSON.parse(await readBoundedResponseText(response, { signal }));
    if (!isString(data?.accessToken) || !data.accessToken || !isString(data.refreshToken) || !data.refreshToken) return { status: "error" };
    if (sessions.get(id) !== session || session.expiresAt <= Date.now()) return { status: "expired" };
    sessions.delete(id);
    return { status: "ok", accessToken: data.accessToken, refreshToken: data.refreshToken };
  } catch {
    return { status: "error" };
  } finally { session.polling = false; }
}

export function cursorTokenDetails(token) {
  let payload = {};
  try { payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) ?? {}; } catch { /* opaque token */ }
  const sub = isString(payload.sub) ? payload.sub : Number.isSafeInteger(payload.sub) ? String(payload.sub) : null;
  const email = isString(payload.email) && payload.email ? payload.email.toLowerCase() : null;
  const expiry = isNumber(payload.exp) && Number.isFinite(payload.exp) ? payload.exp * 1000 : Date.now() + 3600000;
  return { accountId: sub, email, expiresAt: new Date(expiry).toJSON() ?? new Date(Date.now() + 3600000).toISOString() };
}
