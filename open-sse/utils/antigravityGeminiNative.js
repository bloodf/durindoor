import { isNumber, isRecord, isString } from "../../src/shared/utils/typeChecks.js";

// Cloud Code wraps Gemini responses; retain all native fields and candidate parts.
export function antigravityGeminiResponse(chunk, aliases, defaultFinish = false) {
  const response = structuredClone(chunk?.response || chunk);
  if (!isRecord(response)) return response;
  if (Object.hasOwn(response, "cpaUsageMetadata")) {
    response.usageMetadata = response.cpaUsageMetadata;
    delete response.cpaUsageMetadata;
  }
  for (const candidate of response.candidates || []) {
    if (defaultFinish && !candidate.finishReason) candidate.finishReason = "STOP";
    for (const part of candidate?.content?.parts || []) {
      for (const key of ["functionCall", "functionResponse", "function_call", "function_response"]) {
        const call = part[key];
        if (call && aliases?.has(call.name)) call.name = aliases.get(call.name);
      }
    }
  }
  return response;
}

// Assemble streamed candidate fragments by index when a provider requires SSE
// but the client requested a single GenerateContentResponse.
export function collectAntigravityGeminiSSE(text, aliases) {
  let result = {};
  const candidates = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const chunk = JSON.parse(data);
    const response = antigravityGeminiResponse(chunk, aliases);
    if (!isRecord(response)) continue;
    const { candidates: items, ...metadata } = response;
    result = { ...result, ...metadata };
    for (const [position, candidate] of (items || []).entries()) {
      const index = candidate.index ?? position;
      const previous = candidates.get(index);
      if (!previous) { candidates.set(index, candidate); continue; }
      const parts = [...(previous.content?.parts || []), ...(candidate.content?.parts || [])];
      candidates.set(index, { ...previous, ...candidate, content: { ...previous.content, ...candidate.content, parts } });
    }
  }
  if (candidates.size) result.candidates = [...candidates.values()];
  return antigravityGeminiResponse(result, aliases, true);
}

// ── Google RPC stream errors (CLIProxyAPI 249ea68 sdk/api/handlers/gemini/gemini_handlers.go, MIT) ──
// google.rpc.Code names with their canonical HTTP mapping.
const HTTP_BY_RPC_STATUS = new Map([
  ["CANCELLED", 499], ["UNKNOWN", 500], ["INVALID_ARGUMENT", 400], ["DEADLINE_EXCEEDED", 504],
  ["NOT_FOUND", 404], ["ALREADY_EXISTS", 409], ["PERMISSION_DENIED", 403], ["UNAUTHENTICATED", 401],
  ["RESOURCE_EXHAUSTED", 429], ["FAILED_PRECONDITION", 400], ["ABORTED", 409], ["OUT_OF_RANGE", 400],
  ["UNIMPLEMENTED", 501], ["INTERNAL", 500], ["UNAVAILABLE", 503], ["DATA_LOSS", 500],
]);
const RPC_STATUS_BY_HTTP = new Map([
  [400, "INVALID_ARGUMENT"], [401, "UNAUTHENTICATED"], [403, "PERMISSION_DENIED"], [404, "NOT_FOUND"],
  [408, "DEADLINE_EXCEEDED"], [409, "ABORTED"], [429, "RESOURCE_EXHAUSTED"], [499, "CANCELLED"],
  [501, "UNIMPLEMENTED"], [502, "UNAVAILABLE"], [503, "UNAVAILABLE"], [504, "DEADLINE_EXCEEDED"],
]);

function rpcStatusForHttp(code) {
  return RPC_STATUS_BY_HTTP.get(code) || (code >= 500 ? "INTERNAL" : "INVALID_ARGUMENT");
}

function httpErrorCode(value) {
  const code = isString(value) && /^\d{3}$/.test(value.trim()) ? Number(value) : value;
  return isNumber(code) && Number.isInteger(code) && code >= 400 && code <= 599 ? code : null;
}

function errorObjectOf(error) {
  if (!isString(error)) return isRecord(error) ? error : {};
  try {
    const parsed = JSON.parse(error);
    const nested = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
    if (isRecord(nested)) return nested;
  } catch { /* plain text message */ }
  return { message: error };
}

/**
 * Build a Google RPC error body (`{"error":{code,message,status,details?}}`)
 * with an integer HTTP code and a canonical status. Upstream RPC fields and
 * object `details` entries are kept; OpenAI-style string codes are replaced.
 * Callers pass an already redacted error.
 *
 * @param {unknown} error Error object, Google RPC envelope text, or message.
 * @param {number} [fallbackCode] HTTP code when the error carries none.
 * @returns {{ error: { code: number, message: string, status: string, details?: object[] } }}
 */
export function googleRpcErrorBody(error, fallbackCode = 500) {
  const source = errorObjectOf(error);
  const rpcStatus = isString(source.status) ? source.status.trim().toUpperCase() : "";
  const code = httpErrorCode(source.code) ?? HTTP_BY_RPC_STATUS.get(rpcStatus) ?? fallbackCode;
  const status = HTTP_BY_RPC_STATUS.has(rpcStatus) ? rpcStatus : rpcStatusForHttp(code);
  const message = isString(source.message) && source.message.trim() ? source.message.trim() : status;
  const body = { error: { code, message, status } };
  const details = Array.isArray(source.details) ? source.details.filter(isRecord) : [];
  if (details.length > 0) body.error.details = details;
  return body;
}

/**
 * Post-commit error frame for a native Gemini stream: one raw Google RPC JSON
 * object, without `data:` or `event:` framing and without `[DONE]`, so the
 * Go and JS genai SDKs raise it as an APIError instead of a response chunk.
 *
 * @param {unknown} error
 * @param {number} [fallbackCode]
 * @returns {string}
 */
export function formatGoogleRpcStreamError(error, fallbackCode = 500) {
  return `${JSON.stringify(googleRpcErrorBody(error, fallbackCode))}\n\n`;
}
