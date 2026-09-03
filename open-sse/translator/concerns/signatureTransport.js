// Tool-call ID transport for provider-issued Gemini thought signatures.
//
// The Antigravity/Gemini -> OpenAI -> Gemini round trip loses provider-issued
// `thoughtSignature` values because the OpenAI intermediate representation has
// no field for them; the request translator then replays a synthetic default
// signature and Gemini can reject the history with HTTP 400 (issue #676,
// upstream decolua/9router#3645).
//
// This helper carries both the raw upstream function-call id and the optional
// provider-issued signature inside the OpenAI tool-call id itself, using a
// base64url payload so the result still matches the Anthropic tool_use id
// constraint (^[a-zA-Z0-9_-]+$). Decoding is strictly opt-in via the prefix:
// ids that were never encoded pass through unchanged.

import { isString } from "../../../src/shared/utils/typeChecks.js";

const SIGNATURE_ID_PREFIX = "agsig1_";

/**
 * Encode a raw upstream tool-call id plus a provider-issued thought signature
 * into a single transport-safe OpenAI tool-call id. Without a signature the
 * id is sanitized exactly like the historical fallback behavior.
 */
export function encodeToolCallIdWithSignature(rawId, signature) {
  const id = String(rawId ?? "");
  if (!signature) return id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const payload = JSON.stringify({ i: id, s: String(signature) });
  return SIGNATURE_ID_PREFIX + Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Decode a tool-call id produced by {@link encodeToolCallIdWithSignature}.
 * Returns `{ id, signature }`; for unencoded (or merely prefix-colliding)
 * ids the input id is returned untouched with a null signature.
 */
export function decodeToolCallId(id) {
  if (!isString(id) || !id.startsWith(SIGNATURE_ID_PREFIX)) {
    return { id, signature: null };
  }
  try {
    const raw = Buffer.from(id.slice(SIGNATURE_ID_PREFIX.length), "base64url").toString("utf8");
    const payload = JSON.parse(raw);
    if (payload && isString(payload.i) && payload.i && isString(payload.s) && payload.s) {
      return { id: payload.i, signature: payload.s };
    }
  } catch {
    // Not our encoding — treat as a plain id that happens to share the prefix.
  }
  return { id, signature: null };
}
