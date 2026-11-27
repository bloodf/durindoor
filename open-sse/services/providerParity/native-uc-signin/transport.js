// One bounded request to the Clerk Frontend API for the staged UC sign-in
// and session controllers. Port of the request shape shared by OmniRoute
// c71f0065 open-sse/executors/uc/emailLogin.ts and clerkAuth.ts:
//
//   sign-in (emailLogin.ts:44, 130, 187, 230):
//     POST https://clerk.uncensored.com{path}?__clerk_api_version=2025-11-10&_clerk_js_version=5.127.1
//   token mint (clerkAuth.ts:95; no API version):
//     POST https://clerk.uncensored.com/v1/client/sessions/{sid}/tokens?_clerk_js_version=5.127.1
//   headers (emailLogin.ts:47-55, clerkAuth.ts:96-101):
//     Origin: https://uncensored.com
//     Referer: https://uncensored.com/
//     Content-Type: application/x-www-form-urlencoded
//     Cookie: <this account's jar only, when it has one>
//   body: `k=encodeURIComponent(v)` pairs in source order (emailLogin.ts:133,
//     191, 234), or "" for the mint (clerkAuth.ts:108).
//
// Fork deviations: the transport is injected (no global fetch); the caller's
// signal and a deadline bound both the request and the body read, and the wait
// ends even when the transport ignores its signal; a redirect is refused and
// never followed with the cookie; an answer from any other origin is refused;
// the body is read with a byte cap and is never quoted; Set-Cookie values are
// kept only when they are cookie-safe and scoped to uncensored.com.
import { readBoundedResponseText } from "../../../utils/error.js";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { cookieHeader, normalizeCookieJar } from "../native-uc-tts/credentials.js";
import {
  UC_APP_ORIGIN,
  UC_CLERK_API_VERSION,
  UC_CLERK_FAPI,
  UC_CLERK_JS_VERSION,
  UC_MAX_RESPONSE_BYTES,
  UC_REQUEST_TIMEOUT_MS,
} from "./config.js";

const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/** Clerk URL. `apiVersion: false` is the mint query (clerkAuth.ts:95), which carries only the JS version. */
export const ucClerkUrl = (path, { apiVersion = true } = {}) =>
  apiVersion
    ? `${UC_CLERK_FAPI}${path}?__clerk_api_version=${UC_CLERK_API_VERSION}&_clerk_js_version=${UC_CLERK_JS_VERSION}`
    : `${UC_CLERK_FAPI}${path}?_clerk_js_version=${UC_CLERK_JS_VERSION}`;

/** Form body exactly as the source writes it: insertion order, `encodeURIComponent` values. */
export const ucClerkForm = (form) =>
  Object.entries(form ?? {}).map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`).join("&");

export function ucClerkHeaders(cookies) {
  const headers = {
    Origin: UC_APP_ORIGIN,
    Referer: `${UC_APP_ORIGIN}/`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const jar = cookieHeader(cookies ?? {});
  if (jar) headers.Cookie = jar;
  return headers;
}

function cookieDomainAllowed(attributes) {
  const domain = attributes.find((part) => /^domain=/i.test(part));
  if (!domain) return true;
  const host = domain.slice(7).trim().replace(/^\./, "").toLowerCase();
  return host === "uncensored.com" || host === "clerk.uncensored.com";
}

/** Cookie-safe `{ name: value }` pairs from Set-Cookie headers scoped to uncensored.com. */
export function parseSetCookies(headers) {
  const lines = isFunction(headers?.getSetCookie) ? headers.getSetCookie() : [];
  const raw = {};
  for (const line of lines) {
    if (!isString(line)) continue;
    const [pair, ...attributes] = line.split(";").map((part) => part.trim());
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    if (!cookieDomainAllowed(attributes)) continue;
    const expired = attributes.some((part) => /^max-age=(0|-\d+)$/i.test(part));
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1).replace(/^"|"$/g, "");
    raw[name] = expired ? "" : value;
  }
  return normalizeCookieJar(raw);
}

/** The first Clerk error code of a body, when it is code-shaped. */
export function clerkErrorCode(body) {
  const first = isRecord(body) && Array.isArray(body.errors) ? body.errors[0] : null;
  return isRecord(first) && isString(first.code) && ERROR_CODE.test(first.code) ? first.code : null;
}

/** `body.response` when Clerk wraps the resource (`{ response, client }`), else the body. */
export const clerkResource = (body) => (isRecord(body?.response) ? body.response : isRecord(body) ? body : null);

function deadlineRace(promise, signals) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    for (const s of signals) {
      if (s.aborted) return onAbort();
      s.addEventListener("abort", onAbort, { once: true });
    }
    promise.then(resolve, reject).finally(() => {
      for (const s of signals) s.removeEventListener("abort", onAbort);
    });
  });
}

/**
 * One POST to the fixed Clerk host. Never throws. Result:
 *   { ok: true, status, body, cookies, retryAfter }   any non-redirect answer from the Clerk origin
 *   { ok: false, kind: "aborted" | "timeout" | "network" | "redirect" | "foreign" | "malformed", status? }
 * `cookies` holds only the cookies this answer set.
 */
export async function ucClerkPost(fetchImpl, path, { form = {}, cookies = {}, apiVersion = true, signal, timeoutMs = UC_REQUEST_TIMEOUT_MS } = {}) {
  if (signal?.aborted) return { ok: false, kind: "aborted" };
  const deadline = AbortSignal.timeout(Math.max(1, timeoutMs));
  const signals = signal ? [signal, deadline] : [deadline];
  const fetchSignal = AbortSignal.any(signals);
  const failed = (kind, extra) => ({ ok: false, kind: signal?.aborted ? "aborted" : deadline.aborted ? "timeout" : kind, ...extra });
  let response;
  try {
    const request = Promise.resolve().then(() => fetchImpl(ucClerkUrl(path, { apiVersion }), {
      method: "POST",
      headers: ucClerkHeaders(cookies),
      body: ucClerkForm(form),
      redirect: "manual",
      signal: fetchSignal,
    }));
    request.then((late) => { if (fetchSignal.aborted) discard(late); }, () => {});
    response = await deadlineRace(request, signals);
  } catch {
    return failed("network");
  }
  if (!isNumber(response?.status)) return failed("malformed");
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    return failed("redirect");
  }
  let origin = UC_CLERK_FAPI;
  try {
    if (response.url) origin = new URL(response.url).origin;
  } catch {
    origin = null;
  }
  if (response.redirected || origin !== UC_CLERK_FAPI) {
    discard(response);
    return failed("foreign");
  }
  let text;
  try {
    text = await readBoundedResponseText(response, { signal: fetchSignal, maxBytes: UC_MAX_RESPONSE_BYTES, timeoutMs: Math.max(1, timeoutMs), throwOnTimeout: true });
  } catch {
    discard(response);
    return failed("malformed", { status: response.status });
  }
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  return {
    ok: true,
    status: response.status,
    body: isRecord(body) ? body : null,
    cookies: parseSetCookies(response.headers),
    retryAfter: response.headers?.get?.("retry-after") ?? null,
  };
}
