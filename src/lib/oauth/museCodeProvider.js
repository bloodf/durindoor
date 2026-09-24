/**
 * Muse Code (Meta) OAuth adapter: RFC 8628 device grant against auth.meta.com.
 *
 * The grant returns a durable `dca:` token. postExchange mints the
 * subscription inference key from it; the mint is best effort, so a login
 * whose mint fails is still saved with the `dca:` token and MuseCodeExecutor
 * mints the key before the first request.
 */
import { PROVIDER_OAUTH } from "open-sse/providers/index.js";
import {
  MUSE_CODE_DEFAULT_POLL_INTERVAL_SEC,
  MUSE_CODE_DEVICE_GRANT,
  isMuseDcaToken,
  museCodeHeaders } from
"open-sse/config/museCode.js";
import { mintMuseApiKey, museMintMetadata } from "open-sse/services/museCodeAuth.js";
import { isNumber, isString } from "../../shared/utils/typeChecks.js";

async function postForm(url, params, proxyOptions) {
  const response = await fetch(url, {
    method: "POST",
    headers: museCodeHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
    body: new URLSearchParams(params),
    proxyOptions
  });
  const text = await response.text();
  try {
    return { ok: response.ok, data: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: response.ok, data: { error: "invalid_response", error_description: text.slice(0, 200) } };
  }
}

function requiredText(value, field) {
  if (!isString(value) || !value.trim()) {
    throw new Error(`Muse Code device authorization response missing ${field}`);
  }
  return value.trim();
}

export default {
  config: { ...PROVIDER_OAUTH["muse-code"] },
  flowType: "device_code",
  requestDeviceCode: async (config, _codeChallenge, _options, proxyOptions) => {
    const { ok, data } = await postForm(config.deviceCodeUrl, { client_id: config.clientId }, proxyOptions);
    if (!ok) throw new Error("Muse Code device authorization request failed.");
    const expiresIn = Number(data.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("Muse Code returned an invalid device code expiry.");
    }
    const interval = Number(data.interval);
    return {
      device_code: requiredText(data.device_code, "device_code"),
      user_code: requiredText(data.user_code, "user_code"),
      verification_uri: isString(data.verification_uri) ? data.verification_uri : "",
      verification_uri_complete: isString(data.verification_uri_complete) ? data.verification_uri_complete : "",
      expires_in: expiresIn,
      interval: Number.isFinite(interval) && interval > 0 ? interval : MUSE_CODE_DEFAULT_POLL_INTERVAL_SEC
    };
  },
  pollToken: async (config, deviceCode, _codeVerifier, _extraData, proxyOptions) =>
  postForm(config.tokenUrl, {
    client_id: config.clientId,
    device_code: deviceCode,
    grant_type: MUSE_CODE_DEVICE_GRANT
  }, proxyOptions),
  postExchange: async (tokens, proxyOptions) => {
    const dcaToken = isString(tokens.access_token) ? tokens.access_token.trim() : "";
    if (!dcaToken) throw new Error("Muse Code device flow completed without an access token.");
    try {
      return { dcaToken, minted: await mintMuseApiKey(dcaToken, proxyOptions) };
    } catch {
      return { dcaToken };
    }
  },
  mapTokens: (tokens, extra) => {
    const dcaToken = extra?.dcaToken || tokens.access_token;
    const minted = extra?.minted;
    const expiresIn = isNumber(tokens.expires_in) ? tokens.expires_in : undefined;
    return {
      // Until a key is minted, the dca token stands in and triggers a remint.
      accessToken: minted?.apiKey || dcaToken,
      refreshToken: dcaToken,
      // A minted key does not inherit the dca expiry; it is reminted on 401.
      expiresIn: minted?.apiKey ? undefined : expiresIn,
      email: minted?.email || null,
      displayName: minted?.name || minted?.email || null,
      providerSpecificData: {
        authKind: "oauth",
        dcaToken: isMuseDcaToken(dcaToken) ? dcaToken : undefined,
        ...(minted ? museMintMetadata(minted) : null),
        dcaExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined
      }
    };
  }
};
