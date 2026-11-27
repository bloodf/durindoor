// Public staging exports for the Kimi sign-in parity unit (#2034).
// Private staging metadata: no production module imports this directory yet.
// See `registration.json` for the exact exports and the central integration
// slots that consume them.
export {
  KIMI_CODING_CLIENT_ID,
  KIMI_CODING_CLIENT_ID_ENV,
  KIMI_CODING_PROVIDER_IDS,
  KIMI_DEVICE_PENDING_ERRORS,
  KIMI_DEVICE_POLL_INTERVAL_FLOOR_SECONDS,
  KIMI_DEVICE_POLL_MAX_SECONDS,
  KIMI_DEVICE_TERMINAL_ERRORS,
  KIMI_OAUTH_GRANT_DEVICE,
  KIMI_OAUTH_GRANT_REFRESH,
  KIMI_OAUTH_REGIONS,
  isKimiCodingProvider,
  resolveKimiOAuthRegion
} from "./config.js";
export {
  buildKimiDeviceIdentityHeaders,
  deriveKimiDeviceIdFromRefreshToken,
  getKimiDeviceFacts,
  normalizeKimiDeviceId,
  resolveKimiDeviceId,
  sanitizeKimiHeaderValue
} from "./identity.js";
