import { isNumber, isRecord, isString } from "../../../../shared/utils/typeChecks.js";

/** Staged Grok Build browser and token import helpers. Not registered in production.
 * Based on OmniRoute grok-cli-oauth.ts and grok-cli.ts at b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523 (MIT).
 */
export const GROK_BROWSER_SCOPE = "openid profile email offline_access grok-cli:access";
export const GROK_BROWSER_REDIRECT_URI = "http://127.0.0.1:56122/callback";

export function buildGrokBrowserAuthUrl(config, redirectUri, state, codeChallenge) {
  if (!state || !codeChallenge || redirectUri !== GROK_BROWSER_REDIRECT_URI) throw new Error("Invalid Grok browser authorization parameters");
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: redirectUri, scope: GROK_BROWSER_SCOPE, code_challenge: codeChallenge, code_challenge_method: "S256", state }).toString();
  return url.toString();
}

export async function exchangeGrokBrowserCode(config, code, redirectUri, verifier, proxyOptions = null) {
  if (!code || !verifier || redirectUri !== GROK_BROWSER_REDIRECT_URI) throw new Error("Invalid Grok browser exchange parameters");
  const response = await fetch(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, code, redirect_uri: redirectUri, code_verifier: verifier }), proxyOptions });
  if (!response.ok) throw new Error(`Grok browser token exchange failed (HTTP ${response.status})`);
  const tokens = await response.json();
  if (!isString(tokens.access_token) || !tokens.access_token.trim()) throw new Error("Grok token response missing access_token");
  return tokens;
}

/** Import one explicitly selected auth.json entry, or one raw JWT; never retain the full file. */
export function mapGrokImportedToken(input, selectedKey, now = Date.now()) {
  let value = input;
  if (isRecord(input)) {
    if (!selectedKey || !Object.hasOwn(input, selectedKey)) throw new Error("Select a Grok account to import");
    value = input[selectedKey];
  }
  const token = isString(value) ? value : value?.key;
  if (!isString(token) || token.split(".").length !== 3) throw new Error("Invalid Grok access token");
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); } catch { throw new Error("Invalid Grok access token"); }
  if (!isRecord(claims)) throw new Error("Invalid Grok access token");
  const expiration = isNumber(claims.exp) && Number.isFinite(claims.exp) ? Math.max(1, Math.floor(claims.exp - now / 1000)) : 21600;
  const providerSpecificData = { authMethod: "imported" };
  if (selectedKey) providerSpecificData.sourceAccount = selectedKey;
  return { accessToken: token, refreshToken: isString(value?.refresh_token) ? value.refresh_token : null, expiresIn: expiration, email: isString(claims.email) ? claims.email : null, providerSpecificData };
}
