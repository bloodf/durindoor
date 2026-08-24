import { isBoolean, isObject, isString } from "@/shared/utils/typeChecks.js"; /**
 * ClinePass response-envelope helpers.
 *
 * Cline's `/api/v1/chat/completions` endpoint wraps every body in a
 * `{ success: boolean, data: <payload>, error?: <string|object> }` envelope.
 * The proxy speaks OpenAI to clients, so success envelopes must be unwrapped
 * to `data` before translation, and failure envelopes must surface the inner
 * error message (not the raw wrapper).
 *
 * Source: decolua/9router#2332 @ 005d970f49.
 */

/**
 * Unwrap a ClinePass `{success, data}` envelope.
 *
 * Returns `{ body, error }`:
 *  - non-clinepass providers or non-envelope bodies → `{ body, error: null }`
 *    (pass-through, so other providers are unaffected);
 *  - `{success:true, data}` → `{ body: data, error: null }`;
 *  - `{success:false, error}` → `{ body, error: { message } }` so callers can
 *    fail fast without translating the wrapper.
 *
 * @param {unknown} body - parsed JSON body
 * @param {string} [provider] - provider id; envelopes are only honored for "clinepass"
 * @returns {{ body: unknown, error: null | { message: string } }}
 */
export function unwrapClinepassEnvelope(body, provider) {
  if (provider !== "clinepass") return { body, error: null };
  if (!body || !isObject(body) || !isBoolean(body.success)) {
    return { body, error: null };
  }
  if (body.success === true) {
    return "data" in body && body.data !== null && isObject(body.data) ?
    { body: body.data, error: null } :
    { body, error: null };
  }

  const err = body.error;
  let message = "";
  if (isString(err)) message = err;else
  if (err && isObject(err)) message = err.message || err.code || "";
  if (!message && isString(body.message)) message = body.message;
  return { body, error: { message: message || "ClinePass request failed" } };
}