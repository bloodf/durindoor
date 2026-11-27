/** Pinned OmniRoute CodeBuddy device auth sends an empty JSON state body. */
export function codebuddyStateBody() {
  return "{}";
}

/** Do not pass provider response bodies or messages to the OAuth client. */
export function codebuddyStateFailure() {
  return new Error("CodeBuddy state request failed");
}

/** Normalize non-pending provider errors without exposing provider messages. */
export function codebuddyPollFailure() {
  return { ok: false, data: { error: "codebuddy_authorization_failed" } };
}

/** Do not return an upstream billing message or transport exception to clients. */
export function codebuddyUsageFailure() {
  return { message: "CodeBuddy CN quota request failed." };
}
