import { isString } from "../../src/shared/utils/typeChecks.js"; // Fields that strict upstream gateways may reject by literal name in a 400
// response. BaseExecutor strips one matching top-level request field and retries
// once, preserving compatibility with clients that send harmless extension data.
export const KNOWN_OFFENDING_FIELDS = [
"reasoning_budget",
"chat_template",
"reasoning_content",
"context_management",
"client_metadata",
"thinking",
"reasoning"];


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