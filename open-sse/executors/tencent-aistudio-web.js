// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/executors/tencent-aistudio-web.ts (MIT).
//
// Wire contract, as the pinned source defines it: one cookie-authenticated POST
// to /api/chat/<Model> carrying {model, messages}. The pinned source forwards
// the upstream response untouched and assumes it already speaks OpenAI Chat
// Completions. This port keeps that wire contract, adds the session and error
// handling the source lacks (expired session, quota, redirect to login) and
// normalises JSON/SSE so the reply always matches what the caller asked for.
//
// Replay safety: the chat POST is billable work. Once it may have reached the
// vendor (a connection that failed after sending, a 502/504 from an
// intermediary, or a 2xx whose body cannot be read), nothing proves the vendor
// did not accept it, so the attempt is answered as `upstream_outcome_unknown`
// and never replayed, on this account or a sibling (singleModel/postProcess.js).
// Explicit 401/403/429 answers and a refused sign-in redirect stay ordinary
// refusals that account fallback may act on.
import { WebSessionExecutor } from "./webSessionBase.js";
import { errorResponse } from "../utils/error.js";
import { isRefusedRedirect } from "./sendRequest.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { stripCookieInputPrefix } from "../../src/shared/utils/cookieValue.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

// Same code as MINIMAX_CODE_OUTCOME_UNKNOWN (minimax-code.js), which singleModel/postProcess.js
// treats as terminal: the send may have been accepted, so it is never replayed.
const OUTCOME_UNKNOWN = "upstream_outcome_unknown";
// Connection failures raised before the request could reach the vendor.
const UNSENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "ERR_PROXY_CONNECTION_FAILED"]);
/** True only when the thrown transport error proves the request never left. */
function isUnsentError(error) {
  for (let current = error, depth = 0; depth < 4 && current; depth += 1, current = current.cause) {
    if (isString(current.code) && UNSENT_CODES.has(current.code)) return true;
  }
  return false;
}

export const TENCENT_AISTUDIO_ORIGIN = "https://aistudio.tencent.ai";
export const TENCENT_AISTUDIO_PROBE_URL = `${TENCENT_AISTUDIO_ORIGIN}/api/user/info`;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_MODEL = "hy3-g";
const MODEL_MAP = { "hy3-g": "HunyuanDefault", "hunyuan-default": "HunyuanDefault", "hunyuan-3d": "Hunyuan3D" };

const isAuthStatus = (status) => status === 401 || status === 403;
const modelKey = (model) => String(model || DEFAULT_MODEL).split("/").at(-1).toLowerCase();

/** The Cookie header value for a stored credential, without a pasted `Cookie:` prefix. */
export function tencentAIStudioCookie(value) {
  return isString(value) ? stripCookieInputPrefix(value).trim() : "";
}

const UNKNOWN_OUTCOME_MESSAGE = "Tencent AI Studio did not confirm whether it processed the request. It was not retried; check the conversation before sending it again.";

/** A billable attempt the vendor may have accepted: terminal, never replayed. */
function outcomeUnknown(status = 502) {
  return errorResponse(status, UNKNOWN_OUTCOME_MESSAGE, { type: "upstream_error", code: OUTCOME_UNKNOWN });
}

/**
 * Keep the outcome-unknown code on a parsed error so singleModel/postProcess.js can stop
 * account fallback and the outer transient retry. Any other body parses unchanged.
 */
function outcomeUnknownParse(parsed, bodyText) {
  try {
    const error = JSON.parse(bodyText)?.error;
    if (error?.code !== OUTCOME_UNKNOWN || !isString(error.message)) return parsed;
    return { ...parsed, message: error.message, errorBody: { error: { type: error.type, code: error.code, message: error.message } } };
  } catch {
    return parsed;
  }
}

function failure(status, retryAfter) {
  if (isAuthStatus(status)) return errorResponse(401, "Tencent AI Studio session expired or was rejected. Sign in at aistudio.tencent.ai and re-import the cookie.", { type: "authentication_error", code: "session_expired" });
  if (status === 429) return errorResponse(429, "Tencent AI Studio quota or rate limit reached. Try again later.", { type: "rate_limit_error", code: "rate_limited" }, retryAfter);
  // An intermediary answered for a request the vendor may already have accepted.
  if (status === 502 || status === 504) return outcomeUnknown(status);
  return errorResponse(status >= 400 ? status : 502, `Tencent AI Studio request failed (HTTP ${status})`, { type: "upstream_error", code: `HTTP_${status}` });
}

const retryAfterSeconds = (response) => {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
};

/**
 * Check a stored cookie against the session probe. `fetcher` is injectable so
 * the dashboard can route the call through the connection's proxy.
 * Result: {valid, status, error?, expired?, rateLimited?, unavailable?}.
 */
export async function validateTencentAIStudioSession({ apiKey, fetcher = fetch, signal } = {}) {
  const cookie = tencentAIStudioCookie(apiKey);
  if (!cookie || !cookie.includes("=")) return { valid: false, status: null, error: "Paste the Cookie header from aistudio.tencent.ai (name=value pairs)." };
  let response;
  try {
    response = await fetcher(TENCENT_AISTUDIO_PROBE_URL, { method: "GET", headers: { accept: "application/json", cookie, origin: TENCENT_AISTUDIO_ORIGIN, referer: `${TENCENT_AISTUDIO_ORIGIN}/`, "user-agent": USER_AGENT }, redirect: "manual", signal: signal ?? AbortSignal.timeout(8000) });
  } catch {
    return { valid: false, status: null, unavailable: true, error: "Provider unavailable - network request failed" };
  }
  const { status } = response;
  // A 3xx answer is the sign-in redirect an expired session receives.
  if (isAuthStatus(status) || (status >= 300 && status < 400)) return { valid: false, status, expired: true, error: "Tencent AI Studio session expired - sign in again and re-import the cookie." };
  if (status === 429) return { valid: false, status, rateLimited: true, unavailable: true, error: "Tencent AI Studio rate limit reached - try again later." };
  if (response.ok) return { valid: true, status };
  return { valid: false, status, unavailable: status >= 500, error: `Tencent AI Studio validation failed (HTTP ${status})` };
}

function completion(model, content) {
  return { id: `chatcmpl-tencent-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] };
}

const frames = (text) => text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter((data) => data && data !== "[DONE]");

/** Fold an OpenAI SSE body into one chat.completion for a non-streaming caller. */
function sseToCompletion(text, model) {
  let content = ""; let finish = "stop"; let usage; let id; let created;
  for (const data of frames(text)) {
    let frame; try { frame = JSON.parse(data); } catch { continue; }
    id ??= frame.id; created ??= frame.created; usage = frame.usage ?? usage;
    const choice = frame.choices?.[0];
    if (isString(choice?.delta?.content)) content += choice.delta.content;
    if (choice?.finish_reason) finish = choice.finish_reason;
  }
  const result = completion(model, content);
  result.choices[0].finish_reason = finish;
  if (id) result.id = id; if (created) result.created = created; if (usage) result.usage = usage;
  return result;
}

/** Re-frame a JSON completion as SSE for a streaming caller. */
function completionToSse(payload, model) {
  const choice = payload.choices?.[0];
  const base = { id: payload.id ?? `chatcmpl-tencent-${Date.now()}`, object: "chat.completion.chunk", created: payload.created ?? Math.floor(Date.now() / 1000), model: payload.model ?? model };
  const chunk = (delta, finish, extra = {}) => `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
  const text = isString(choice?.message?.content) ? choice.message.content : "";
  return chunk({ role: "assistant" }, null) + chunk({ content: text }, null) + chunk({}, choice?.finish_reason ?? "stop", payload.usage ? { usage: payload.usage } : {}) + "data: [DONE]\n\n";
}

export class TencentAIStudioWebExecutor extends WebSessionExecutor {
  constructor() { super("tencent-aistudio-web", { id: "tencent-aistudio-web", baseUrl: TENCENT_AISTUDIO_ORIGIN }, { observePatchedFetch: false }); }

  buildUrl(model) { return `${TENCENT_AISTUDIO_ORIGIN}/api/chat/${MODEL_MAP[modelKey(model)] || "HunyuanDefault"}`; }

  /** Carry this executor's own outcome-unknown code to the account layer; other answers parse as before. */
  parseError(response, bodyText) {
    return outcomeUnknownParse(super.parseError(response, bodyText), bodyText);
  }

  async runSession(input, { sendBillable }) {
    const key = modelKey(input.model);
    const url = this.buildUrl(key);
    const cookie = tencentAIStudioCookie(input.credentials?.apiKey);
    const reply = (response, headers = {}) => ({ response, url, headers, transformedBody: input.body });
    if (!cookie) return reply(errorResponse(401, "Tencent AI Studio cookie is required. Sign in at aistudio.tencent.ai and paste your Cookie header.", { type: "authentication_error", code: "missing_cookie" }));
    const wantsStream = input.stream === true || input.body?.stream === true;
    const headers = { "content-type": "application/json", accept: wantsStream ? "text/event-stream" : "application/json", cookie, origin: TENCENT_AISTUDIO_ORIGIN, referer: `${TENCENT_AISTUDIO_ORIGIN}/`, "user-agent": USER_AGENT };
    const body = { model: MODEL_MAP[key] || "HunyuanDefault", messages: Array.isArray(input.body?.messages) ? input.body.messages : [], stream: wantsStream };
    let upstream;
    try {
      upstream = await sendBillable(url, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (error) {
      if (error?.name === "AbortError" || isQuotaDispatchUnavailable(error)) throw error;
      // The sign-in redirect an expired session receives.
      if (isRefusedRedirect(error)) return reply(failure(401), { cookie: "[REDACTED]" });
      // Only a connection proven never to reach the vendor is an ordinary network failure.
      if (isUnsentError(error)) return reply(errorResponse(502, "Tencent AI Studio request failed: network error", { type: "upstream_error", code: "network_error" }), { cookie: "[REDACTED]" });
      return reply(outcomeUnknown(), { cookie: "[REDACTED]" });
    }
    const shownHeaders = { ...headers, cookie: "[REDACTED]" };
    const { status } = upstream;
    if (!upstream.ok || (status >= 300 && status < 400)) {
      const retryAfter = retryAfterSeconds(upstream);
      await upstream.text().catch(() => "");
      return reply(failure(status >= 300 && status < 400 ? 401 : status, retryAfter), shownHeaders);
    }
    const isSse = /text\/event-stream/i.test(upstream.headers.get("content-type") || "");
    // Matching shape: hand the upstream body through untouched, as the pinned source does.
    if (isSse === wantsStream) return reply(upstream, shownHeaders);
    // The vendor accepted the POST; an unreadable 2xx body leaves the outcome unknown.
    let text;
    try { text = await upstream.text(); } catch (error) {
      if (error?.name === "AbortError") throw error;
      return reply(outcomeUnknown(), shownHeaders);
    }
    if (wantsStream) {
      let payload; try { payload = JSON.parse(text); } catch { return reply(outcomeUnknown(), shownHeaders); }
      return reply(new Response(completionToSse(payload, key), { status: 200, headers: { "content-type": "text/event-stream" } }), shownHeaders);
    }
    return reply(Response.json(sseToCompletion(text, key)), shownHeaders);
  }
}
export default TencentAIStudioWebExecutor;
