// OmniRoute #21076 (77b4f9efd236): Anthropic's out-of-credit answer is an HTTP 400
// typed `invalid_request_error`. The balance belongs to the whole API key, so it
// benches the connection, also on an anthropic-compatible-* node. The match stays
// narrow (leading phrase inside Anthropic's envelope) because a 400 can echo input.
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const CREDIT_PHRASE = "your credit balance is too low";
const CREDIT_ERROR_TYPES = new Set(["invalid_request_error", "billing_error"]);

export function isAnthropicCreditProvider(provider) {
  return isString(provider) && (provider === "anthropic" || provider.startsWith("anthropic-compatible-"));
}

/** True for Anthropic's JSON envelope, or its bare message (optionally "[400]: "-prefixed). */
export function isAnthropicAccountCreditExhausted(errorText, structuredError = null) {
  let body = structuredError;
  const text = isString(errorText) ? errorText.trim().replace(/^\[400\]:\s*/, "") : "";
  if (!body) {
    if (!text.startsWith("{")) return text.toLowerCase().startsWith(CREDIT_PHRASE);
    try { body = JSON.parse(text); } catch { return false; }
  }
  if (!isObject(body) || body.type !== "error" || !CREDIT_ERROR_TYPES.has(body.error?.type)) return false;
  return isString(body.error.message) && body.error.message.toLowerCase().startsWith(CREDIT_PHRASE);
}
