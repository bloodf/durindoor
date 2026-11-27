/**
 * Staged Gemini CLI web integration helpers. These use the existing provider
 * config and transport; registration is performed by the shared OAuth batch.
 */
export async function exchangeGeminiCode(config, code, redirectUri, _verifier, _state, _meta, proxyOptions, signal) {
  if (!config?.clientId || !config?.clientSecret) throw new Error("Gemini CLI OAuth client is not configured");
  if (!code || !redirectUri) throw new Error("Gemini CLI authorization code and redirect URI are required");
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri }),
    proxyOptions,
    signal
  });
  if (!response.ok) throw new Error(`Gemini CLI token exchange failed (HTTP ${response.status})`);
  return response.json();
}

/** Bind discovery refresh to the same configured client used for sign-in. */
export function refreshGeminiDiscoveryToken(refreshGoogleToken, config, connection, proxyOptions) {
  if (!config?.clientId || !config?.clientSecret || !connection?.refreshToken) return null;
  return refreshGoogleToken(connection.refreshToken, config.clientId, config.clientSecret, null, proxyOptions);
}
