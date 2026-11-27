import { createHash } from "node:crypto";
import { cancelDiscardedResponse, isRefusedRedirect } from "../sendRequest.js";
import { INNER_AI_WEB_MODELS_URL, INNER_AI_WEB_ORIGIN, INNER_AI_WEB_PROFILE_URL } from "../../providers/registry/inner-ai-web.js";
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";
import { headerSafeEmail } from "./credential.js";
import { InnerAiWebError, expiredSession, httpFailure, isSessionRejection, malformedReply } from "./errors.js";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const NON_TEXT_MODEL = /image|video|audio|img|vid|sound|music|voice|tts|stt|track|clip|avatar|cartoon|flux|stable.diff|recraft|ideogram|leonardo|magnific|bria|seedream|luma|kling|pika|veo|wan-|heygen|did-|vidu|pixverse|sora-|gen-[0-9]|playground|gemini-fal|gamma|lyria|clothes|whisper/i;

const identityHeaders = (token) => ({
  "User-Agent": USER_AGENT,
  Cookie: `token=${token}`,
  "USER-TOKEN": token,
  Origin: INNER_AI_WEB_ORIGIN,
  Referer: `${INNER_AI_WEB_ORIGIN}/`,
});

/** The header set of the catalog and chat requests. */
export function innerAiWebHeaders({ token, deviceId }, email) {
  return {
    "Content-Type": "application/json",
    ...identityHeaders(token),
    "DEVICE-ID": deviceId,
    ...(email ? { "USER-EMAIL": email } : null),
  };
}

export const isAbort = (error, signal) => signal?.aborted || error?.name === "AbortError";

/** A transport rejection as a mapped failure; aborts pass through untouched. */
export function transportFailure(error, signal) {
  if (isAbort(error, signal)) return error;
  if (isRefusedRedirect(error)) return expiredSession();
  if (error?.name === "TimeoutError") return new InnerAiWebError(504, "Inner.ai Web request timed out");
  return new InnerAiWebError(502, "Inner.ai Web request failed: network error", "upstream_error", "network_error");
}

/** Best-effort email lookup. A rejected session still stops here, before any other send. */
async function profileEmail(session, send, signal) {
  const headers = { ...identityHeaders(session.token), ...(session.deviceId ? { "DEVICE-ID": session.deviceId } : null) };
  let response;
  try {
    response = await send(INNER_AI_WEB_PROFILE_URL, { method: "GET", headers, redirect: "manual", signal });
  } catch (error) {
    const failure = transportFailure(error, signal);
    if (isAbort(error, signal) || failure.status === 401) throw failure;
    return { ok: false, email: "" };
  }
  if (!response.ok) {
    cancelDiscardedResponse(response);
    if (isSessionRejection(response.status)) throw expiredSession();
    return { ok: false, email: "" };
  }
  const body = await response.json().catch((error) => {
    if (isAbort(error, signal)) throw error;
    return null;
  });
  const email = [body?.data?.email, body?.user?.email, body?.profile?.email, body?.email].map(headerSafeEmail).find(Boolean) ?? "";
  return { ok: true, email };
}

/** Keep the enabled text models this account's plan may use. */
function accountTextModels(rows, plan) {
  const ultra = plan.includes("ultra") || plan.includes("enterprise");
  const pro = ultra || plan.includes("pro") || plan.includes("plus");
  return rows.filter((row) => {
    if (!isRecord(row) || !isString(row.id) || !row.id || !isString(row.llm_model) || !row.llm_model) return false;
    if (row.enable === false || row.unavailable_api || (row.ultra_only && !ultra) || (row.pro_only && !pro)) return false;
    const categories = Array.isArray(row.ai_model_categories) ? row.ai_model_categories : [];
    if (categories.length) return categories.some((entry) => String(entry?.unique_identifier ?? entry?.name ?? "").toLowerCase() === "text");
    return !NON_TEXT_MODEL.test(row.llm_model);
  });
}

async function accountCatalog(session, email, send, signal) {
  let response;
  try {
    response = await send(INNER_AI_WEB_MODELS_URL, { method: "GET", headers: innerAiWebHeaders(session, email), redirect: "manual", signal });
  } catch (error) {
    throw transportFailure(error, signal);
  }
  if (!response.ok) {
    cancelDiscardedResponse(response);
    throw httpFailure(response, "model discovery");
  }
  const body = await response.json().catch((error) => {
    if (isAbort(error, signal)) throw error;
    return null;
  });
  const rows = [body, body?.data, body?.ai_models].find(Array.isArray);
  if (!rows) throw malformedReply("an unreadable model catalog");
  return accountTextModels(rows, session.plan);
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

/**
 * A per-executor cache keyed by a digest of the exact token and pasted email, so
 * one account never reads another's email or catalog.
 */
export function createDiscoveryCache() {
  const entries = new Map();
  const keyOf = ({ token, credentialEmail }) => createHash("sha256").update(`${token}\0${credentialEmail}`).digest("hex");
  return {
    forget: (session) => entries.delete(keyOf(session)),
    async resolve(session, send, signal) {
      const key = keyOf(session);
      const cached = entries.get(key);
      if (cached && Date.now() < cached.expiresAt) return cached;
      entries.delete(key);
      const profile = await profileEmail(session, send, signal);
      // The pinned order: profile, then the pasted email, then an email-shaped JWT subject.
      const email = profile.email || session.credentialEmail || session.subject;
      const models = await accountCatalog(session, email, send, signal);
      const result = { email, models, expiresAt: Date.now() + CACHE_TTL_MS };
      // A failed profile lookup or an empty catalog is retried on the next request.
      if (profile.ok && models.length) {
        entries.set(key, result);
        if (entries.size > CACHE_MAX_ENTRIES) entries.delete(entries.keys().next().value);
      }
      return result;
    },
  };
}

/**
 * Match a requested id: exact, then case-insensitive, then the same id behind a
 * vendor prefix or a date suffix. Unlike the pinned substring match, this never
 * answers `gpt-4.1` with `gpt-4.1-mini`.
 */
export function findInnerAiWebModel(models, requested) {
  const wanted = String(requested).toLowerCase();
  const baseName = (id) => id.toLowerCase().split("/").at(-1).replace(/-\d{8}$/, "");
  return models.find((model) => model.llm_model === requested) ??
    models.find((model) => model.llm_model.toLowerCase() === wanted) ??
    models.find((model) => baseName(model.llm_model) === wanted) ??
    null;
}
