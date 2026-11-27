// MiniMax Code sign-in provider record.
//
// Registered in the shared OAuth provider table as a device-code provider:
//
//   import { minimaxCodeOAuthProvider } from "./services/minimax-code.js";
//   ... PROVIDERS["minimax-code"] = minimaxCodeOAuthProvider
//
// Flow: OAuth2 device authorization (RFC 8628) with S256 PKCE. The generic device route
// generates the verifier/challenge pair and hands the challenge to requestDeviceCode; the
// verifier comes back to pollToken. The region (en/cn) picks the account host and is packed
// into the device code so the poll reaches the host that issued it.
import {
  MINIMAX_CODE_OAUTH_CONFIG,
  mapMinimaxCodeTokens,
  pollMinimaxCodeDeviceToken,
  requestMinimaxCodeDeviceCode,
} from "../../../../open-sse/services/minimaxCodeAuth.js";

const DEVICE_ERRORS = new Set(["authorization_pending", "slow_down", "expired_token", "access_denied", "invalid_grant", "network_error"]);

export const minimaxCodeOAuthProvider = {
  config: MINIMAX_CODE_OAUTH_CONFIG,
  flowType: "device_code",
  async requestDeviceCode(config, codeChallenge, options = {}, proxyOptions = null) {
    try {
      return await requestMinimaxCodeDeviceCode({ region: options?.region, codeChallenge, proxyOptions });
    } catch (error) {
      // Account response descriptions are untrusted and may contain credentials.
      if (error?.code === "device_authorization_failed") {
        error.message = "MiniMax Code device authorization failed.";
      }
      throw error;
    }
  },
  async pollToken(config, deviceCode, codeVerifier, extraData = null, proxyOptions = null) {
    const result = await pollMinimaxCodeDeviceToken({ deviceCode, codeVerifier, proxyOptions });
    if (result.ok) return result;
    return { ok: false, data: { error: DEVICE_ERRORS.has(result.data?.error) ? result.data.error : "poll_failed", error_description: "" } };
  },
  mapTokens: (tokens) => mapMinimaxCodeTokens(tokens),
};

export default minimaxCodeOAuthProvider;
