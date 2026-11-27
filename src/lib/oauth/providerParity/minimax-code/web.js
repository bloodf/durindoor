/**
 * Guard MiniMax Code's device-only web entry points before creating a flow.
 * The device route still owns PKCE, state, ownership and connection storage.
 */
export function assertMinimaxCodeWebAction(action) {
  if (action === "authorize" || action === "exchange" || action === "import-token") {
    const error = new Error("MiniMax Code supports device sign-in only.");
    error.code = "OAUTH_VALIDATION_FAILED";
    throw error;
  }
}
