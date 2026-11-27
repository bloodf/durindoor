// Private UC consumer email-code sign-in controller. Port of OmniRoute
// c71f0065 open-sse/executors/uc/emailLogin.ts (all calls form-encoded POSTs,
// query `__clerk_api_version=2025-11-10&_clerk_js_version=5.127.1`, lines 44-55):
//
//   1. POST /v1/client/sign_ins            locale=en-CA&identifier=<email>        (:130-135)
//        -> { response: { id: "sia_…", status: "needs_first_factor",
//             supported_first_factors: [{ strategy: "email_code", email_address_id: "idn_…" }] } }
//        Any Set-Cookie becomes the jar carried into steps 2 and 3     (:140-143)
//   2. POST …/sign_ins/{sia}/prepare_first_factor
//        email_address_id=<idn>&strategy=email_code; only HTTP 200 is checked (:186-205)
//   3. POST …/sign_ins/{sia}/attempt_first_factor
//        strategy=email_code&code=<code>, Cookie = the step-1 jar     (:229-237)
//        -> { response: { status: "complete", created_session_id: "sess_…" },
//             client: { sessions: [{ id: "sess_…", user: { id: "<uid>" } }] } }
//        + Set-Cookie: __client=<durable JWT>                           (:260-303)
//   The credential is { clientCookie: attempt Set-Cookie __client,
//   sid: created_session_id, uid: the session's user.id, cookies: the
//   attempt Set-Cookie jar } (:287, :302).
//
// Fork deviations:
// - Guarded opt-in: DURINDOOR_UC_CONSUMER_SIGNIN=1 and `consent: true` per start.
// - The pending state (sign-in id, factor id, cookie jar) never leaves this
//   controller. Callers hold only an opaque random flow id; verify reads only
//   `flowId` and `code`, so no caller body can supply or resume sign-in state.
// - Each flow has its own jar; there is no shared jar across flows or accounts.
// - Bounded: flow TTL, verify attempts, pending flow count, per-request deadline.
// - Step 1 must answer `needs_first_factor`; a captcha/bot challenge or a
//   second factor ends the flow as `needs_operator`; nothing tries to bypass it.
// - A prepare answer that names another sign-in id is refused.
// - The uid is taken only from the session whose id is created_session_id; the
//   source's fallback to sessions[0] (:280) is not ported, so another account's
//   session in the same client is never picked.
// - Success is returned only after one session mint with the harvested jar
//   succeeds and its JWT names no other uid or sid, and the metadata passes the
//   staged TTS credential resolver; any malformed success is dropped and
//   nothing is saved.
// - Results never echo the email, code, cookies, ids or upstream bodies.
import { randomUUID } from "node:crypto";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  UC_FLOW_TTL_MS,
  UC_MAX_EMAIL_LENGTH,
  UC_MAX_PENDING_FLOWS,
  UC_MAX_VERIFY_ATTEMPTS,
  UC_REQUEST_TIMEOUT_MS,
  UC_SIGNIN_STRATEGY,
  isUcConsumerSignInEnabled,
} from "./config.js";
import { buildUcConnectionMetadata, mergeCookies, mintUcSession, ucFailure } from "./session.js";
import { clerkErrorCode, clerkResource, ucClerkPost } from "./transport.js";

/** Step-1 locale the source sends (emailLogin.ts:133). */
export const UC_SIGNIN_LOCALE = "en-CA";

const EMAIL = /^[^\s@"<>()[\]\\,;:]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const CODE = /^\d{6}$/;
const SIGN_IN_ID = /^sia_[A-Za-z0-9]{1,64}$/;
const FACTOR_ID = /^idn_[A-Za-z0-9]{1,64}$/;
const SESSION_ID = /^sess_[A-Za-z0-9]{1,64}$/;
const UID = /^[A-Za-z0-9-]{1,128}$/;
const FLOW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const CHALLENGE_CODES = new Set(["captcha_invalid", "captcha_missing_token", "captcha_not_enabled", "requires_captcha", "bot_detected", "device_blocked"]);
const EXPIRED_CODES = new Set(["verification_expired", "verification_failed", "sign_in_expired", "client_state_invalid"]);
const NOT_ALLOWED_CODES = new Set(["form_identifier_not_found", "form_param_format_invalid", "strategy_for_user_invalid", "not_allowed_access", "identifier_not_allowed_access", "user_locked"]);

/** Map a non-success Clerk answer during sign-in. */
function signInFailure(answer) {
  if (!answer.ok) return ucFailure(answer.kind, answer.status ? { status: answer.status } : {});
  const code = clerkErrorCode(answer.body);
  if (answer.status === 429) return ucFailure("rate_limited", { status: 429, retryAfter: answer.retryAfter });
  if (answer.status === 401 || answer.status === 403 || (code && CHALLENGE_CODES.has(code))) {
    return ucFailure("needs_operator", { reason: "challenge", status: answer.status });
  }
  if (code && EXPIRED_CODES.has(code)) return ucFailure("expired", { status: answer.status });
  if (code === "form_code_incorrect") return ucFailure("code_incorrect", { status: answer.status });
  if (answer.status >= 400 && answer.status < 500) return ucFailure("rejected", { status: answer.status, reason: code && NOT_ALLOWED_CODES.has(code) ? code : "rejected" });
  return ucFailure(answer.status === 200 ? "malformed" : "upstream", { status: answer.status });
}

function emailFactor(resource) {
  const factors = Array.isArray(resource?.supported_first_factors) ? resource.supported_first_factors : [];
  const factor = factors.find((f) => isRecord(f) && f.strategy === UC_SIGNIN_STRATEGY);
  return factor && isString(factor.email_address_id) && FACTOR_ID.test(factor.email_address_id) ? factor.email_address_id : null;
}

/** `client.sessions[id === sid].user.id` of the attempt answer (emailLogin.ts:273-285), or null. */
function uidFromAttempt(body, sessionId) {
  const sessions = Array.isArray(body?.client?.sessions) ? body.client.sessions : [];
  const session = sessions.find((s) => isRecord(s) && s.id === sessionId);
  const value = isRecord(session?.user) ? session.user.id : null;
  return isString(value) && UID.test(value) ? value : null;
}

/**
 * Private sign-in controller.
 *   start({ email, consent }, { signal })   -> { ok, flowId, state: "code_sent", expiresAt, attemptsLeft } | failure
 *   verify({ flowId, code }, { signal })    -> { ok, providerSpecificData } | failure
 *   cancel(flowId)                          -> boolean
 *   pending                                 number of live flows
 */
export function createUcSignInController({
  fetchImpl,
  env = process.env,
  now = Date.now,
  newFlowId = randomUUID,
  flowTtlMs = UC_FLOW_TTL_MS,
  maxVerifyAttempts = UC_MAX_VERIFY_ATTEMPTS,
  maxPendingFlows = UC_MAX_PENDING_FLOWS,
  timeoutMs = UC_REQUEST_TIMEOUT_MS,
} = {}) {
  const ttl = Math.max(1, Math.min(UC_FLOW_TTL_MS, flowTtlMs));
  const attemptsCap = Math.max(1, Math.min(UC_MAX_VERIFY_ATTEMPTS, maxVerifyAttempts));
  const flowCap = Math.max(1, Math.min(UC_MAX_PENDING_FLOWS, maxPendingFlows));
  const flows = new Map();

  const end = (flow) => {
    if (flows.get(flow.id) === flow) flows.delete(flow.id);
    flow.controller.abort();
  };
  const prune = () => {
    for (const flow of flows.values()) if (flow.expiresAt <= now()) end(flow);
  };
  const live = (flow) => flows.get(flow.id) === flow && !flow.controller.signal.aborted;
  const scoped = (flow, signal) => {
    const signals = [flow.controller.signal, AbortSignal.timeout(Math.max(1, flow.expiresAt - now()))];
    if (signal) signals.push(signal);
    return AbortSignal.any(signals);
  };
  // A request that ended because the flow was cancelled or ran out of time.
  const interrupted = (flow, result) => {
    if (flows.get(flow.id) !== flow) return ucFailure("cancelled");
    if (flow.expiresAt <= now()) {
      end(flow);
      return ucFailure("expired");
    }
    return result;
  };

  async function start(input, { signal } = {}) {
    if (!isUcConsumerSignInEnabled(env)) return ucFailure("disabled");
    if (input?.consent !== true) return ucFailure("consent_required");
    const email = isString(input?.email) ? input.email.trim() : "";
    if (!email || email.length > UC_MAX_EMAIL_LENGTH || !EMAIL.test(email)) return ucFailure("invalid_input");
    prune();
    if (flows.size >= flowCap) return ucFailure("capacity");
    const id = newFlowId();
    if (!FLOW_ID.test(id) || flows.has(id)) return ucFailure("capacity");
    const flow = { id, controller: new AbortController(), expiresAt: now() + ttl, attempts: 0, busy: true, cookies: {}, signInId: null, factorId: null };
    flows.set(id, flow);
    const fail = (result) => {
      const out = interrupted(flow, result);
      end(flow);
      return out;
    };

    const created = await ucClerkPost(fetchImpl, "/v1/client/sign_ins", { form: { locale: UC_SIGNIN_LOCALE, identifier: email }, signal: scoped(flow, signal), timeoutMs });
    if (!live(flow)) return fail(ucFailure("aborted"));
    if (!created.ok || created.status !== 200) return fail(signInFailure(created));
    flow.cookies = mergeCookies(flow.cookies, created.cookies);
    const attempt = clerkResource(created.body);
    const signInId = isString(attempt?.id) && SIGN_IN_ID.test(attempt.id) ? attempt.id : null;
    if (!signInId) return fail(ucFailure("malformed", { status: 200 }));
    if (attempt.status !== "needs_first_factor") return fail(ucFailure("needs_operator", { reason: "unsupported_flow" }));
    const factorId = emailFactor(attempt);
    if (!factorId) return fail(ucFailure("needs_operator", { reason: "unsupported_factor" }));

    const prepared = await ucClerkPost(fetchImpl, `/v1/client/sign_ins/${signInId}/prepare_first_factor`, {
      form: { email_address_id: factorId, strategy: UC_SIGNIN_STRATEGY },
      cookies: flow.cookies,
      signal: scoped(flow, signal),
      timeoutMs,
    });
    if (!live(flow)) return fail(ucFailure("aborted"));
    if (!prepared.ok || prepared.status !== 200) return fail(signInFailure(prepared));
    // The source checks only the status (emailLogin.ts:198); a body that names another attempt is refused.
    const preparedId = clerkResource(prepared.body)?.id;
    if (preparedId !== undefined && preparedId !== signInId) return fail(ucFailure("malformed", { status: 200 }));
    flow.signInId = signInId;
    flow.factorId = factorId;
    flow.busy = false;
    return { ok: true, flowId: id, state: "code_sent", expiresAt: flow.expiresAt, attemptsLeft: attemptsCap };
  }

  async function finish(flow, answer, signal) {
    const resource = clerkResource(answer.body);
    if (resource?.status === "needs_second_factor") return ucFailure("needs_operator", { reason: "mfa" });
    if (resource?.status !== "complete") return ucFailure("needs_operator", { reason: "unsupported_flow" });
    const sid = isString(resource.created_session_id) && SESSION_ID.test(resource.created_session_id) ? resource.created_session_id : null;
    // The durable cookie must come from this answer's Set-Cookie (emailLogin.ts:287-294),
    // and the saved jar is this answer's Set-Cookie (emailLogin.ts:302).
    const cookies = mergeCookies({}, answer.cookies);
    const uid = sid ? uidFromAttempt(answer.body, sid) : null;
    if (!sid || !uid || !cookies.__client) return ucFailure("malformed", { status: 200 });
    const minted = await mintUcSession(fetchImpl, { sid, cookies, expectedUid: uid }, { signal: scoped(flow, signal), timeoutMs });
    if (!live(flow)) return interrupted(flow, ucFailure("aborted"));
    if (!minted.ok) return minted.kind === "aborted" || minted.kind === "timeout" ? interrupted(flow, minted) : minted;
    const metadata = buildUcConnectionMetadata({ clientCookie: minted.cookies.__client, sid, uid, cookies: minted.cookies, source: "email-code", now: now() });
    return metadata ? { ok: true, providerSpecificData: metadata } : ucFailure("malformed", { status: 200 });
  }

  async function verify(input, { signal } = {}) {
    if (!isUcConsumerSignInEnabled(env)) return ucFailure("disabled");
    const flowId = isString(input?.flowId) ? input.flowId : "";
    const code = isString(input?.code) ? input.code.trim() : "";
    const flow = FLOW_ID.test(flowId) ? flows.get(flowId) : null;
    if (!flow) return ucFailure("unknown_flow");
    if (flow.expiresAt <= now()) {
      end(flow);
      return ucFailure("expired");
    }
    if (flow.busy) return ucFailure("busy");
    if (!CODE.test(code)) return ucFailure("invalid_input", { attemptsLeft: attemptsCap - flow.attempts });
    flow.attempts += 1;
    flow.busy = true;
    const answer = await ucClerkPost(fetchImpl, `/v1/client/sign_ins/${flow.signInId}/attempt_first_factor`, {
      form: { strategy: UC_SIGNIN_STRATEGY, code },
      cookies: flow.cookies,
      signal: scoped(flow, signal),
      timeoutMs,
    });
    if (!live(flow)) return interrupted(flow, ucFailure("aborted"));
    if (answer.ok && answer.status === 200) {
      const result = await finish(flow, answer, signal);
      end(flow);
      return result;
    }
    const failure = signInFailure(answer);
    if (failure.kind === "code_incorrect") {
      // The retry carries the step-1 jar again, as the source's verify does (emailLogin.ts:233).
      const attemptsLeft = attemptsCap - flow.attempts;
      if (attemptsLeft <= 0) {
        end(flow);
        return ucFailure("attempts_exhausted");
      }
      flow.busy = false;
      return { ...failure, attemptsLeft };
    }
    // A caller abort leaves the flow usable; every other failure ends it.
    if (failure.kind === "aborted" && signal?.aborted) {
      flow.busy = false;
      return { ...failure, attemptsLeft: attemptsCap - flow.attempts };
    }
    const out = interrupted(flow, failure);
    end(flow);
    return out;
  }

  return Object.freeze({
    start,
    verify,
    cancel(flowId) {
      const flow = isString(flowId) ? flows.get(flowId) : null;
      if (!flow) return false;
      end(flow);
      return true;
    },
    get pending() {
      prune();
      return flows.size;
    },
  });
}
