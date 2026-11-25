/**
 * Outcome of an OAuth completion the dashboard walked away from.
 *
 * It is not a provider failure: nothing was saved and the account has no
 * project problem. The `OAUTH_` code lets the OAuth route and
 * `exchangeAndSaveAuthorizationCode` pass it through unwrapped.
 */
export class OAuthCancelledError extends Error {
  constructor(message = "OAuth sign-in was cancelled") {
    super(message);
    this.name = "OAuthCancelledError";
    this.code = "OAUTH_CANCELLED";
  }
}

/** Throw the cancelled outcome when the caller's signal has already fired. */
export function throwIfOAuthCancelled(signal) {
  if (signal?.aborted) throw new OAuthCancelledError();
}
