// Staged replacement for the Qwen entry in src/lib/oauth/providers.js.
// The existing OAuth flow owns PKCE, flow state, proxy selection and storage.
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const POLL_ERRORS = new Set(["authorization_pending", "slow_down", "expired_token", "access_denied"]);

async function postForm(url, fields, proxyOptions) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields),
    proxyOptions,
  }).catch(() => { throw new Error("Qwen OAuth request failed"); });
}

/** Provider handlers for the existing device-code OAuth flow. */
export function createQwenProviderHandlers(config) {
  return {
    config,
    flowType: "device_code",
    async requestDeviceCode(config, codeChallenge, options = {}, proxyOptions) {
      const response = await postForm(config.deviceCodeUrl, {
        client_id: config.clientId,
        scope: config.scope,
        code_challenge: codeChallenge,
        code_challenge_method: config.codeChallengeMethod,
      }, proxyOptions);
      if (!response.ok) throw new Error("Qwen device authorization failed");
      return response.json().catch(() => { throw new Error("Qwen device authorization failed"); });
    },
    async pollToken(config, deviceCode, codeVerifier, extraData, proxyOptions) {
      const response = await postForm(config.tokenUrl, {
        grant_type: DEVICE_GRANT,
        client_id: config.clientId,
        device_code: deviceCode,
        code_verifier: codeVerifier,
      }, proxyOptions);
      if (response.ok) {
        const data = await response.json().catch(() => { throw new Error("Qwen token request failed"); });
        return { ok: true, data };
      }
      let error;
      try { error = (await response.json()).error; } catch { /* Ignore untrusted response bodies. */ }
      return { ok: false, data: { error: POLL_ERRORS.has(error) ? error : "oauth_upstream_error" } };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      providerSpecificData: { resourceUrl: tokens.resource_url },
    }),
  };
}
