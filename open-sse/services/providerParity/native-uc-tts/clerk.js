// Clerk `__session` mint for the staged UC TTS adapter. Port of OmniRoute
// c71f0065 open-sse/executors/uc/clerkAuth.ts mintUcSessionToken:
//
//   POST https://clerk.uncensored.com/v1/client/sessions/{sid}/tokens?_clerk_js_version=5.127.1
//     Origin: https://uncensored.com
//     Referer: https://uncensored.com/
//     Cookie: <jar incl. __client>
//     Content-Type: application/x-www-form-urlencoded
//     body: ""
//   -> 200 { "object": "token", "jwt": "<60 s JWT>" }   (source also reads `token`)
//
// Fork deviations: bounded by the caller's signal and a per-call deadline; a
// redirect is refused (never followed with the cookie); an answer from any
// other origin is refused; the body is read with a byte cap and never quoted;
// the JWT must be JWT-shaped and, when it names a `uid`, match the selected
// connection's uid. No cross-connection token cache: each call mints with its
// own connection (the source TTS path mints per call too).
import { readBoundedResponseText } from "../../../utils/error.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { UC_CLERK_FAPI, UC_CLERK_JS_VERSION, UC_MAX_JWT_LENGTH, UC_MAX_MINT_BYTES, UC_MINT_TIMEOUT_MS, UC_ORIGIN } from "./config.js";
import { cookieHeader, uidFromSessionJwt } from "./credentials.js";

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const discard = (response) => void response?.body?.cancel?.().catch(() => {});

export const ucMintUrl = (sid) => `${UC_CLERK_FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${UC_CLERK_JS_VERSION}`;

export const ucMintHeaders = (cookies) => ({
  Origin: UC_ORIGIN,
  Referer: `${UC_ORIGIN}/`,
  Cookie: cookieHeader(cookies),
  "Content-Type": "application/x-www-form-urlencoded",
});

/**
 * Mint one session JWT. Never throws. Result kinds:
 *   { ok: true, jwt }
 *   { ok: false, kind: "aborted" | "timeout" | "network" | "redirect" | "foreign" | "status" | "malformed" | "identity", status? }
 * A mint is not billable work, so no outcome here is an accepted job.
 */
export async function mintUcSessionToken(credential, { signal, timeoutMs = UC_MINT_TIMEOUT_MS } = {}) {
  if (signal?.aborted) return { ok: false, kind: "aborted" };
  const deadline = AbortSignal.timeout(Math.max(1, timeoutMs));
  const fetchSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const failed = (kind, extra) => ({ ok: false, kind: signal?.aborted ? "aborted" : deadline.aborted ? "timeout" : kind, ...extra });
  let response;
  try {
    response = await fetch(ucMintUrl(credential.sid), {
      method: "POST",
      headers: ucMintHeaders(credential.cookies),
      body: "",
      redirect: "manual",
      signal: fetchSignal,
    });
  } catch {
    return failed("network");
  }
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
  let text = "";
  try {
    text = await readBoundedResponseText(response, { signal: fetchSignal, maxBytes: UC_MAX_MINT_BYTES, timeoutMs: Math.max(1, timeoutMs), throwOnTimeout: true });
  } catch {
    discard(response);
    return failed(response.status === 200 ? "malformed" : "status", { status: response.status });
  }
  if (response.status !== 200) return failed("status", { status: response.status, retryAfter: response.headers.get("retry-after") });
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  const jwt = isRecord(parsed) ? (isString(parsed.jwt) ? parsed.jwt : isString(parsed.token) ? parsed.token : "") : "";
  if (!jwt || jwt.length > UC_MAX_JWT_LENGTH || !JWT_SHAPE.test(jwt)) return failed("malformed");
  const claimed = uidFromSessionJwt(jwt);
  if (claimed && claimed !== credential.uid) return failed("identity");
  return { ok: true, jwt };
}
