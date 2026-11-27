import { isString } from "../../../../shared/utils/typeChecks.js";

/**
 * Staged ClinePass exchange guard. The existing OAuth route owns state and
 * callback ownership; this helper must be called only after those checks.
 * Based on OmniRoute (MIT), src/lib/oauth/providers/cline.ts at
 * b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523.
 */
export async function exchangeClinepassCode(exchange, args, mode = "authorization_code") {
  if (mode !== "authorization_code") throw new Error("Unsupported ClinePass sign-in mode");
  let tokens;
  try {
    tokens = await exchange(...args);
  } catch {
    throw new Error("ClinePass token exchange failed");
  }
  if (!isString(tokens?.access_token) || !tokens.access_token.trim()) {
    throw new Error("ClinePass token exchange returned no access token");
  }
  return tokens;
}
