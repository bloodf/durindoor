import { isString } from "../../../../shared/utils/typeChecks.js";

/**
 * Codex form exchange, staged for the existing provider exchangeToken slot.
 * MIT source: CLIProxyAPI dbe641f, internal/auth/codex/openai_auth.go.
 * The caller owns state, PKCE, workspace validation and connection persistence.
 */
export async function exchangeCodexCode(config, code, redirectUri, codeVerifier, _state, _meta, proxyOptions, signal) {
  if (!config?.clientId || !config?.tokenUrl || !code || !redirectUri || !codeVerifier) {
    throw new Error("Invalid Codex authorization exchange");
  }
  try {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code", client_id: config.clientId,
        code, redirect_uri: redirectUri, code_verifier: codeVerifier,
      }).toString(),
      proxyOptions,
      signal: signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error();
    const tokens = await response.json();
    if (!isString(tokens?.access_token) || !tokens.access_token.trim() || tokens.error) throw new Error();
    return tokens;
  } catch {
    // Never retry a one-use code or reveal transport errors / upstream bodies.
    throw new Error("Codex token exchange failed");
  }
}
