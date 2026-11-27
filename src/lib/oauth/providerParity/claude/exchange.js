import { isString } from "../../../../shared/utils/typeChecks.js";

/** Bind an optional pasted Claude code fragment to the authenticated flow. */
export function parseClaudeAuthorizationCode(value, state) {
  if (!isString(value) || !value || !isString(state) || !state) {
    throw new Error("Invalid Claude authorization response");
  }
  const parts = value.split("#");
  if (!parts[0] || parts.length > 2 || (parts.length === 2 && parts[1] !== state)) {
    throw new Error("Invalid Claude authorization response");
  }
  return { code: parts[0], state };
}

/** Do not expose provider-controlled response bodies or credentials. */
export function claudeExchangeFailure() {
  return new Error("Claude token exchange failed");
}
