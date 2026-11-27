// UC (uncensored.com) consumer email sign-in and scoped Clerk sessions,
// staged and not registered (#1241, #2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/uc/constants.ts (Clerk Frontend API host, app origin,
// Clerk JS and API versions), open-sse/executors/uc/emailLogin.ts (form POST
// sign_ins -> email_code prepare_first_factor -> attempt_first_factor, then
// __client, created_session_id, uid and cookie jar harvest),
// open-sse/executors/uc/clerkAuth.ts (session token mint; the source has no touch),
// open-sse/executors/uc/credentials.ts (providerSpecificData field names) and
// open-sse/config/providers/registry/uc/index.ts (the `uc` web-cookie row).
//
// The existing `uc-direct` provider (api.uncensored.com, metered REST, `uai_`
// API key) is a different backend. Nothing here reads, writes or produces a
// uc-direct key, and uc-direct is not an equivalent of this module.

import { UC_PROVIDER_DEFINITION } from "../native-uc-tts/config.js";

export const UC_SIGNIN_PROVIDER_ID = "uc";
export const UC_SIGNIN_PROVIDER_ALIAS = "ucn";

/** The only host any request here goes to. Connection base URLs are ignored. */
export const UC_CLERK_FAPI = "https://clerk.uncensored.com";
/** Origin and Referer origin the UC web app sends. */
export const UC_APP_ORIGIN = "https://uncensored.com";
export const UC_CLERK_JS_VERSION = "5.127.1";
export const UC_CLERK_API_VERSION = "2025-11-10";

/** The one sign-in strategy ported. Passwords, OAuth and passkeys are not. */
export const UC_SIGNIN_STRATEGY = "email_code";

/**
 * Source credentials.ts field names, read from the staged TTS definition so
 * the two modules cannot drift. The first name of each list is the canonical
 * name this module writes.
 */
export const UC_CREDENTIAL_FIELDS = UC_PROVIDER_DEFINITION.credentialFields;

/** Metadata this module writes into providerSpecificData. Nothing else is written. */
export const UC_SIGNIN_METADATA_KEYS = Object.freeze([
  UC_CREDENTIAL_FIELDS.clientCookie[0],
  UC_CREDENTIAL_FIELDS.sid[0],
  UC_CREDENTIAL_FIELDS.uid[0],
  UC_CREDENTIAL_FIELDS.cookies[0],
  "ucAuthSource",
  "ucSignedInAt",
]);
export const UC_AUTH_SOURCES = Object.freeze(["email-code", "cookie-import"]);

/**
 * Consumer opt-in. Both guards must hold: the operator sets this variable to
 * exactly "1", and each start or import call passes `consent: true`.
 */
export const UC_SIGNIN_OPT_IN_ENV = "DURINDOOR_UC_CONSUMER_SIGNIN";
export const isUcConsumerSignInEnabled = (env) => env?.[UC_SIGNIN_OPT_IN_ENV] === "1";

// Bounds. Apart from the refresh skew below, the source has none; these are fork additions.
export const UC_REQUEST_TIMEOUT_MS = 15_000;
export const UC_MAX_RESPONSE_BYTES = 64 * 1024;
/** A pending sign-in lives at most this long (Clerk email codes last 10 minutes). */
export const UC_FLOW_TTL_MS = 10 * 60_000;
export const UC_MAX_VERIFY_ATTEMPTS = 5;
export const UC_MAX_PENDING_FLOWS = 32;
/**
 * Session JWTs are refreshed this long before `exp`; the option is clamped.
 * Default is the source UC_TOKEN_REFRESH_SKEW_S = 8 (constants.ts:36).
 */
export const UC_REFRESH_SKEW_DEFAULT_MS = 8_000;
export const UC_REFRESH_SKEW_MIN_MS = 1_000;
export const UC_REFRESH_SKEW_MAX_MS = 30_000;
/** A cached session JWT is never kept longer than this, whatever `exp` says. */
export const UC_MAX_TOKEN_LIFETIME_MS = 120_000;
export const UC_MAX_CACHED_ACCOUNTS = 256;
export const UC_MAX_JWT_LENGTH = 8192;
export const UC_MAX_EMAIL_LENGTH = 254;

/** Fixed messages. No result here ever quotes an email, code, cookie, token or upstream body. */
export const UC_SIGNIN_MESSAGES = Object.freeze({
  disabled: "UC consumer sign-in is not enabled",
  consent_required: "UC consumer sign-in needs explicit consent",
  invalid_input: "UC sign-in input is invalid",
  capacity: "Too many UC sign-ins are pending",
  unknown_flow: "UC sign-in was not found or has ended",
  busy: "UC sign-in is already verifying",
  expired: "UC sign-in expired; start again",
  attempts_exhausted: "UC sign-in code attempts exhausted; start again",
  code_incorrect: "UC sign-in code was not accepted",
  rejected: "UC rejected the sign-in",
  needs_operator: "UC sign-in needs the operator to finish it in the dashboard",
  reauth: "UC session ended; sign in again",
  rate_limited: "UC rate-limited the request",
  cancelled: "UC sign-in was cancelled",
  aborted: "UC request was aborted",
  timeout: "UC request timed out",
  network: "UC could not be reached",
  redirect: "UC answered with a redirect, which is refused",
  foreign: "UC answered from an unexpected origin",
  upstream: "UC answered with an error",
  malformed: "UC answered with an unexpected shape",
  identity: "UC session does not belong to the selected account",
  invalid_credential: "UC credential is missing or unsafe",
});

/** Map a result kind to the HTTP status a dashboard route would answer with. */
export const UC_SIGNIN_HTTP_STATUS = Object.freeze({
  disabled: 403,
  consent_required: 400,
  invalid_input: 400,
  capacity: 429,
  unknown_flow: 404,
  busy: 409,
  expired: 410,
  attempts_exhausted: 410,
  code_incorrect: 400,
  rejected: 400,
  needs_operator: 409,
  reauth: 401,
  rate_limited: 429,
  cancelled: 409,
  aborted: 499,
  timeout: 504,
  network: 502,
  redirect: 502,
  foreign: 502,
  upstream: 502,
  malformed: 502,
  identity: 409,
  invalid_credential: 400,
});
