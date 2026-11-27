// Public staging exports for the GapGPT sign-in unit (#2034).
// Private staging: no production module imports this directory yet. See
// `registration.json` for the central wiring slots that will consume it.
export {
  GAPGPT_CALLBACK_HOST,
  GAPGPT_CALLBACK_HOST_HEADERS,
  GAPGPT_CALLBACK_PATH,
  GAPGPT_CLIENT_ID,
  GAPGPT_FIXED_PORT,
  GAPGPT_LISTEN_HOST,
  GAPGPT_LOOPBACK_REDIRECT_URI,
  GAPGPT_OAUTH_CONFIG,
  GAPGPT_PROVIDER_ID,
  GAPGPT_TOKEN_ORIGIN,
  isGapgptProvider
} from "./config.js";
export {
  GapgptOAuthError,
  buildGapgptRefreshRequest,
  gapgptProvider,
  readGapgptCredential,
  readSafeGapgptErrorCode,
  refreshGapgptCredential,
  unwrapGapgptEnvelope
} from "./provider.js";
export {
  GAPGPT_LOOPBACK_MESSAGES,
  classifyGapgptListenError,
  createGapgptLoopback,
  createNodeLoopbackListener,
  renderGapgptResultPage
} from "./loopback.js";
