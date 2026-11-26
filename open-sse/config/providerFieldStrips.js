// Fields that strict upstream gateways may reject by literal name in a 400
import { isString } from "../../src/shared/utils/typeChecks.js";
// response. BaseExecutor strips one matching top-level request field and retries
// once, preserving compatibility with clients that send harmless extension data.
export const KNOWN_OFFENDING_FIELDS = [
"reasoning_budget",
"chat_template",
"reasoning_content",
"context_management",
"client_metadata",
"thinking",
"reasoning",
// Sampling hint some models disable (Mistral 400 "top_k sampling is not enabled for this model").
"top_k"];


function isNestedPathError(errorText, field) {
  // Do not strip a field when the error points to a nested message content path,
  // e.g. "messages.0.content.0.thinking: Extra inputs are not permitted".
  return new RegExp(`messages\\.\\d+(?:\\.content(?:\\.\\d+)?)?\\.${field}\\b`, "i").test(errorText);
}

export function findOffendingField(errorText = "") {
  const text = isString(errorText) ? errorText : JSON.stringify(errorText || "");
  if (!text) return null;
  return KNOWN_OFFENDING_FIELDS.find((field) => {
    const re = new RegExp(`(?<![-_])\\b${field}\\b(?![-_])`, "i");
    return re.test(text) && !isNestedPathError(text, field);
  }) || null;
}
// Replay-only assistant extensions a strict upstream may reject inside
// messages[] (port of decolua/9router #3325). An allowlist: nothing the
// conversation depends on (role, content, tool_calls) can ever be dropped.
const DROPPABLE_MESSAGE_FIELDS = new Set([
"reasoning_content", "reasoning", "reasoning_details", "encrypted_content", "refusal", "annotations"]);

const REJECTED_MESSAGE_PROPERTY = /\bmessages\.\d+['"`]?\s*:\s*property\s+['"`]([a-z_]+)['"`]\s+(?:is\s+)?unsupported/gi;

function rejectedMessagePaths(errorText) {
  let payload;
  try { payload = JSON.parse(errorText); } catch { return []; }
  const details = payload?.detail ?? payload?.error?.detail ?? payload?.message?.detail;
  if (!Array.isArray(details)) return [];
  return details.
  filter((detail) => detail?.type === "extra_forbidden" && Array.isArray(detail.loc) &&
  detail.loc[0] === "body" && detail.loc[1] === "messages").
  map((detail) => detail.loc[detail.loc.length - 1]);
}

/**
 * The assistant-message field an upstream rejection names, or null. A 400 must
 * use the "messages.N : property 'x' is unsupported" wording; a 422 may echo
 * user content, so only its structured validation paths are trusted.
 */
export function findRejectedMessageField(status, errorText, body) {
  if (!Array.isArray(body?.messages) || !isString(errorText)) return null;
  const named = status === 422 ? rejectedMessagePaths(errorText) :
  status === 400 ? [...errorText.matchAll(REJECTED_MESSAGE_PROPERTY)].map((match) => match[1]) : [];
  return named.find((field) => DROPPABLE_MESSAGE_FIELDS.has(field) &&
  body.messages.some((message) => message?.role === "assistant" && Object.hasOwn(message, field))) || null;
}

/** Copy of `body` without `fields` on assistant turns; user-authored fields stay. */
export function stripAssistantMessageFields(body, fields) {
  return {
    ...body,
    messages: body.messages.map((message) => {
      if (message?.role !== "assistant") return message;
      const next = { ...message };
      for (const field of fields) delete next[field];
      return next;
    })
  };
}
// A 422 may echo user content. Only trust structured top-level validation paths.
export function findRejected422Field(errorText, body) {
  let payload;
  try { payload = JSON.parse(errorText); } catch { return null; }
  const details = payload?.detail ?? payload?.error?.detail ?? payload?.message?.detail;
  if (!Array.isArray(details)) return null;
  const protectedFields = new Set(["model", "messages", "input", "contents", "system", "stream", "tools", "tool_choice"]);
  for (const detail of details) {
    const path = detail?.loc;
    if (!Array.isArray(path) || path.length !== 2 || path[0] !== "body" || !isString(path[1])) continue;
    const field = path[1];
    if (protectedFields.has(field) || !Object.hasOwn(body, field)) continue;
    if (detail.type === "extra_forbidden" || (field === "service_tier" && ["enum", "literal_error"].includes(detail.type))) return field;
  }
  return null;
}
