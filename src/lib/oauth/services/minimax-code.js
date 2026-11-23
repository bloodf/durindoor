// MiniMax Code sign-in provider record (staged).
//
// Same shape as the device-code entries in src/lib/oauth/providers.js, which the
// registration batch wires (this unit does not edit that shared file):
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

export const minimaxCodeOAuthProvider = {
  config: MINIMAX_CODE_OAUTH_CONFIG,
  flowType: "device_code",
  requestDeviceCode: (config, codeChallenge, options = {}, proxyOptions = null) =>
    requestMinimaxCodeDeviceCode({ region: options?.region, codeChallenge, proxyOptions }),
  pollToken: (config, deviceCode, codeVerifier, extraData = null, proxyOptions = null) =>
    pollMinimaxCodeDeviceToken({ deviceCode, codeVerifier, proxyOptions }),
  mapTokens: (tokens) => mapMinimaxCodeTokens(tokens),
};

export default minimaxCodeOAuthProvider;
