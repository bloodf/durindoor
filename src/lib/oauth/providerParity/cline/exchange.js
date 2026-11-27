import { isString } from "../../../../shared/utils/typeChecks.js";

/** Reject tokenless responses before the existing OAuth connection is stored. */
export function validateClineTokens(tokens) {
  if (!isString(tokens?.access_token) || !tokens.access_token.trim()) {
    throw new Error("Cline token exchange failed");
  }
  return tokens;
}

/** Never include provider-controlled response bodies in an exchange error. */
export function clineExchangeFailure() {
  return new Error("Cline token exchange failed");
}
