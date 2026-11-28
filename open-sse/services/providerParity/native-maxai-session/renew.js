// OmniRoute (MIT), 4265bb2/b15b2ee6 refresh.ts + signing.ts. See README.
import { createHash, createHmac, randomInt } from "node:crypto";
import { maxaiAesEncrypt, maxaiStaticHeaders } from "../native-maxai-image/signing.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { readBoundedResponseText } from "../../../utils/error.js";
import { serializeRefresh } from "../../refreshSerializer.js";
import { normalizeMaxaiSession, safeValue, failure } from "./session.js";
import { isRecord } from "../../../../src/shared/utils/typeChecks.js";

export const MAXAI_REFRESH_PATH = "/oauth/refresh_access_token";
const URL = `https://api.maxai.me${MAXAI_REFRESH_PATH}`;

/** Refresh retains the user ID in the proof (it is not a blank-user login route). */
export function signMaxaiRefresh(session, constants, { now = Date.now, random = () => String(randomInt(100000, 1000000)), salt } = {}) {
  if (![constants?.hmacKey, constants?.aesKey, constants?.appVersion, constants?.ctxKey].every(safeValue)) throw new Error("invalid_constants");
  const t = now();
  const sha1 = createHmac("sha1", `${t}:${constants.hmacKey}`)
    .update(`${constants.appVersion}:${t}:${MAXAI_REFRESH_PATH}:${session.userId}`).digest("hex");
  const p = createHash("sm3").update(`${t}:${sha1}:${constants.hmacKey}`).digest("hex");
  const payload = { "X-Client-Domain": "maxai.co", "X-Client-Path": "https://www.maxai.co/app/",
    "X-Random": random(), t, p, d: session.deviceId, [constants.ctxKey]: { a: "" } };
  return { "X-Browser-Name": "Firefox", "X-Browser-Version": "150.0", "X-Browser-Major": "150",
    "X-App-Version": constants.appVersion, "X-App-Env": "MaxAI-Browser-Extension",
    "X-Authorization": maxaiAesEncrypt(JSON.stringify(payload), constants.aesKey, salt) };
}

/**
 * One selected account, one renewal submit, no chat/image replay or persistence.
 * Constants must be supplied by the public owner's bounded constant loader;
 * this helper never discovers keys, performs login, or uses ambient credentials.
 */
export async function renewMaxaiSession({ credentials, proxyOptions = {}, constants, signal, timeoutMs = 10000,
  fetchImpl = proxyAwareFetch, ...unsupported } = {}) {
  if (Object.keys(unsupported).length || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return failure("invalid_options");
  if (!isRecord(proxyOptions) || Object.keys(proxyOptions).some((k) => !["enabled", "url", "connectionProxyEnabled", "connectionProxyUrl"].includes(k))) return failure("invalid_options");
  const session = normalizeMaxaiSession(credentials);
  if (!session.ok || !safeValue(session.refreshToken)) return failure("invalid_session");
  // Copy before any await: caller mutations cannot change the selected egress
  // or signing material. Environment proxy fallback and transport replay are off.
  const enabled = proxyOptions.enabled === true || proxyOptions.connectionProxyEnabled === true;
  const proxyUrl = proxyOptions.url ?? proxyOptions.connectionProxyUrl;
  if (enabled) {
    try {
      if (!safeValue(proxyUrl) || !["http:", "https:", "socks5:", "socks5h:"].includes(new globalThis.URL(proxyUrl).protocol)) return failure("invalid_options");
    } catch { return failure("invalid_options"); }
  }
  const route = { connectionProxyEnabled: enabled,
    connectionProxyUrl: proxyUrl, strictProxy: true, disableEnvProxy: true };
  const keys = { ...constants };
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  if (combined.aborted) return failure("cancelled");
  let timer, onAbort;
  let response;
  const deadline = Date.now() + timeoutMs;
  const stopped = new Promise((_, reject) => {
    onAbort = () => reject(new Error("stopped"));
    combined.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => controller.abort(), timeoutMs);
  });
  const discard = (res) => { void res?.body?.cancel?.().catch(() => {}); };
  const operation = serializeRefresh("maxai", async () => {
    if (combined.aborted) return failure("cancelled");
    const headers = { ...maxaiStaticHeaders(), ...signMaxaiRefresh(session, keys),
      Authorization: `Bearer ${session.refreshToken}`, noAuthLogout: "true" };
    const pending = Promise.resolve().then(() => {
      if (combined.aborted) throw new Error("stopped");
      return fetchImpl(URL, { method: "POST", headers, body: '{"app":"maxai_webapp"}',
        redirect: "manual", credentials: "omit", signal: combined, noTransportReplay: true }, route);
    });
    pending.then((res) => { if (combined.aborted) discard(res); }, () => {});
    response = await pending;
    if (combined.aborted) { discard(response); return failure("cancelled"); }
    if (response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400) || (response.url && response.url !== URL)) {
      discard(response);
      return failure("redirect_refused", response.status);
    }
    if (response.status !== 200) {
      discard(response);
      return failure("refresh_rejected", response.status);
    }
    const raw = await readBoundedResponseText(response, { signal: combined, maxBytes: 65536,
      timeoutMs: Math.max(1, deadline - Date.now()), throwOnTimeout: true });
    let body;
    try { body = JSON.parse(raw); } catch { return failure("invalid_response", 200); }
    const token = body?.data?.access_token ?? body?.access_token;
    if (body?.data?.access_token !== undefined && body?.access_token !== undefined && body.data.access_token !== body.access_token) return failure("invalid_response", 200);
    const next = normalizeMaxaiSession({ accessToken: token, deviceId: session.deviceId,
      userId: session.userId, refreshToken: session.refreshToken });
    return next.ok ? { ...next, status: 200 } : failure("invalid_response", 200);
  });
  try { return await Promise.race([operation, stopped]); }
  catch { return failure(signal?.aborted ? "cancelled" : controller.signal.aborted ? "deadline_exceeded" : "refresh_failed"); }
  finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
    if (combined.aborted) discard(response);
  }
}
