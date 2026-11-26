/**
 * Tells a provider's access refusal apart from a rejected key during key
 * validation (OmniRoute #19963).
 *
 * Many validators map any 403 to "Invalid API key", and some accept every status
 * but 401. A geo, egress or WAF refusal says nothing about the key, so the
 * verdict is re-derived from the last upstream response of the validation. The
 * upstream body is only classified: it is never returned or logged, so an echoed
 * credential cannot leak through the new messages.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const lastResponse = new AsyncLocalStorage();

const MAX_BODY_CHARS = 4096;
const BODY_READ_TIMEOUT_MS = 2000;

const REGION_REFUSAL =
  /unsupported[_\s-]*country|unsupported[_\s-]*region|country[,\s\w]*not supported|region[\s\w]*(is\s+)?not supported|location[\s\w]*(is\s+)?not supported|not available in your (country|region|location)|not (yet )?available in (your|this) (country|region)|geo[\s-]*(block|restrict)|sanction|embargo|restricted (country|region|territor)/i;
const CREDENTIAL_REFUSAL =
  /(invalid|incorrect|bad|wrong|unknown)[\s_-]*(api[\s_-]*)?key|api[\s_-]*key[\s\w]*(invalid|not valid|expired|revoked|disabled)|invalid[\s_-]*(access[\s_-]*)?token|token[\s\w]*(invalid|expired|revoked)|unauthori[sz]ed|unauthenticated|authentication|invalid[\s_-]*credential|API_KEY_INVALID|invalid_api_key/i;
const NETWORK_REFUSAL =
  /access (is )?denied|request (was )?blocked|\bblocked\b|not allowed (from|in)|ip[\s-]*(address)?[\s\w]*(not allowed|blocked|denied|whitelist|allowlist)|firewall|\bwaf\b|cloudflare|forbidden by (policy|administrative rules)/i;
const HTML_PAGE = /<\s*(!doctype\s+html|html|head|body|title)\b/i;

const CANNED_INVALID = /^invalid api (key|token)\b/i;
const GENERIC_FAILURE = /^(provider )?validation failed\b/i;

/**
 * @returns {{ kind: "auth"|"access_denied"|"rate_limited"|"unavailable"|"other", explicit?: boolean }}
 *   `explicit` marks a refusal that overrides even an accepted verdict: HTTP 451
 *   or wording that names a region restriction.
 */
export function classifyValidationRejection(status, body = "") {
  if (status === 401) return { kind: "auth" };
  if (status === 451 || status >= 400 && status < 500 && REGION_REFUSAL.test(body)) {
    return { kind: "access_denied", explicit: true };
  }
  if (status === 403) {
    if (CREDENTIAL_REFUSAL.test(body)) return { kind: "auth" };
    // An HTML page where the API would send its own error is an edge or proxy refusal.
    if (HTML_PAGE.test(body) || NETWORK_REFUSAL.test(body)) return { kind: "access_denied" };
    // A bare 403 stays ambiguous: several providers answer bad keys with it.
    return { kind: "other" };
  }
  if (status === 429) return { kind: "rate_limited" };
  if (status >= 500) return { kind: "unavailable" };
  return { kind: "other" };
}

/** Bounded read of a clone, so a huge or stalled error body cannot hold validation. */
async function readBodyPrefix(response) {
  let reader;
  let timer;
  let text = "";
  try {
    reader = response.clone().body?.getReader();
    if (!reader) return "";
    // Cancelling settles a pending read() as done.
    timer = setTimeout(() => reader.cancel().catch(() => {}), BODY_READ_TIMEOUT_MS);
    const decoder = new TextDecoder();
    while (text.length < MAX_BODY_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // An unreadable body leaves the status as the only evidence.
  } finally {
    clearTimeout(timer);
    // Not awaited: a teed branch settles only once both sides are cancelled.
    reader?.cancel().catch(() => {});
  }
  return text.slice(0, MAX_BODY_CHARS);
}

/** Run `validate`, returning its value and the last upstream response observed inside it. */
export async function traceValidation(validate) {
  const trace = { last: null };
  const value = await lastResponse.run(trace, validate);
  return { value, last: trace.last };
}

/** Record one probe response. A no-op outside traceValidation; never consumes the body. */
export async function observeValidationResponse(response) {
  const trace = lastResponse.getStore();
  if (trace && Number.isInteger(response?.status)) {
    const { status } = response;
    trace.last = { status, body: status >= 400 ? await readBodyPrefix(response) : "" };
  }
  return response;
}

/** Correct a verdict the last upstream response contradicts; otherwise return it unchanged. */
export function refineValidationResult(result, last) {
  if (!result || !last || last.status < 400) return result;
  const { kind, explicit } = classifyValidationRejection(last.status, last.body);
  const error = String(result.error || "");
  const cannedInvalid = result.valid === false && CANNED_INVALID.test(error);
  const detail = `(HTTP ${last.status})`;
  if (kind === "access_denied" &&
      (cannedInvalid || explicit && (result.valid === true || GENERIC_FAILURE.test(error)))) {
    const { warning: _warning, ...rest } = result;
    return {
      ...rest,
      valid: false,
      error: `Access denied by provider ${detail}. The key was not rejected as invalid; the provider refused the request, possibly because of a region or network restriction.`,
    };
  }
  if (cannedInvalid && kind === "rate_limited") return { ...result, error: `Provider rate limited the validation request ${detail}` };
  if (cannedInvalid && kind === "unavailable") return { ...result, error: `Provider unavailable ${detail}` };
  return result;
}
