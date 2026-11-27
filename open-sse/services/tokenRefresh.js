import { refreshCursorToken } from "./tokenRefresh/cursor.js";
import { createPrivateKey } from "node:crypto";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, REFRESH_LEAD_MS } from "../config/appConstants.js";
import {
  refreshXaiToken,
  refreshAccessToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshQwenToken,
  refreshCodexToken,
  refreshKiroToken,
  refreshIflowToken,
  refreshGitHubToken,
  refreshCopilotToken,
  refreshCodebuddyToken,
  refreshKimiToken,
  refreshGitLabDuoToken,
  refreshClineToken,
  classifyOAuthRefreshError } from
"./tokenRefresh/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { resolveCodexAccountId } from "../shared/codexAccountId.js";
import { refreshBoundGheCopilotCredentials } from "../../src/lib/oauth/providerParity/copilot/gheConnection.js";
import { refreshOpenferenceToken } from "./openferenceAuth.js";
import { refreshMuseCodeToken } from "./museCodeAuth.js";
import { refreshM365Token } from "./tokenRefresh/copilotM365.js";
import { refreshMinimaxCodeToken } from "./minimaxCodeAuth.js";
import { refreshWorkbuddyToken } from "./workbuddyAuth.js";
import { createRenderHourRefreshHooks } from "./renderhour/oauth.js";
import { sanitizeErrorMessage } from "../utils/error.js";
import { digestMemoryKey } from "../utils/memoryKey.js";
import { proxyRouteFingerprint } from "./tokenRefresh/dedup.js";
import { antigravityClientBindingBlocks } from "./antigravityClientBinding.js";

// Re-export all provider refresh functions (preserves public API for all consumers)
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";
export {
  refreshAccessToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshQwenToken,
  refreshCodexToken,
  refreshKiroToken,
  refreshIflowToken,
  refreshGitHubToken,
  refreshCopilotToken,
  refreshCodebuddyToken,
  refreshGitLabDuoToken,
  refreshClineToken,
  classifyOAuthRefreshError };


export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function isUnrecoverableRefreshError(result) {
  return (
    result && isObject(
      result) && (
    result.error === "unrecoverable_refresh_error" ||
    result.error === "refresh_token_reused" ||
    result.error === "invalid_request" ||
    result.error === "invalid_grant"));

}

/** Use a positive finite per-connection lead when supplied. */
export function getRefreshLeadMs(provider, providerSpecificData = null) {
  const override = providerSpecificData?.refreshLeadMs;
  if (isNumber(override) && Number.isFinite(override) && override > 0) return override;
  return REFRESH_LEAD_MS[provider] || TOKEN_EXPIRY_BUFFER_MS;
}

export function parseVertexSaJson(apiKey) {
  if (!isString(apiKey)) return null;

  try {
    const parsed = JSON.parse(apiKey);
    if (parsed.type === "service_account" && parsed.client_email && parsed.private_key && parsed.project_id) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Credential shapes a Vertex connection can carry.
 *
 *   - `service_account`: the JSON key downloaded from the Cloud console.
 *   - `authorized_user`: the ADC file written by `gcloud auth application-default login`.
 *   - `api_key`: an opaque Express-mode API key.
 *   - `none`: the connection carries no API key (an OAuth token is used instead).
 */
export const VERTEX_CREDENTIAL = {
  NONE: "none",
  SERVICE_ACCOUNT: "service_account",
  ADC: "authorized_user",
  API_KEY: "api_key",
  UNSUPPORTED: "unsupported"
};

const VERTEX_SERVICE_ACCOUNT_FIELDS = ["client_email", "private_key", "project_id"];
const VERTEX_ADC_FIELDS = ["client_id", "client_secret", "refresh_token"];

function vertexUnsupportedCredentialMessage(parsed) {
  if (parsed?.web || parsed?.installed) {
    return "Vertex: OAuth client JSON is not a Service Account key. Import the Service Account JSON key file, an authorized_user ADC file, or a raw API key.";
  }
  return "Vertex: the credential is a JSON document that is not a Google service account or authorized_user file. Import the Service Account JSON key file, an authorized_user ADC file, or a raw API key.";
}

/**
 * Classify the credential a Vertex connection carries.
 *
 * A JSON document that is neither a Service Account key nor an ADC file is a
 * Google credential shape this gateway cannot use. It must never be demoted to
 * a raw API key: a raw key travels in the URL query string, so that demotion
 * would put a private key, a client secret or a refresh token into the
 * outbound URL and in front of the egress proxy.
 *
 * @param {*} apiKey The stored connection credential.
 * @returns {{kind: string, json: object|null, error: string|null}}
 */
export function classifyVertexCredential(apiKey) {
  if (!isString(apiKey)) return { kind: VERTEX_CREDENTIAL.NONE, json: null, error: null };
  const trimmed = apiKey.trim();
  if (!trimmed) return { kind: VERTEX_CREDENTIAL.NONE, json: null, error: null };
  if (!/^[\[{]/.test(trimmed)) return { kind: VERTEX_CREDENTIAL.API_KEY, json: null, error: null };

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: VERTEX_CREDENTIAL.UNSUPPORTED, json: null, error: "Vertex: malformed credential JSON" };
  }
  if (!isObject(parsed) || Array.isArray(parsed)) {
    return { kind: VERTEX_CREDENTIAL.UNSUPPORTED, json: null, error: vertexUnsupportedCredentialMessage(null) };
  }

  if (parsed.type === "service_account") {
    const missing = VERTEX_SERVICE_ACCOUNT_FIELDS.filter((field) => !parsed[field]);
    return {
      kind: VERTEX_CREDENTIAL.SERVICE_ACCOUNT,
      json: parsed,
      error: missing.length ?
      `Vertex: service account JSON is missing ${missing.join(", ")}` :
      null
    };
  }

  if (parsed.type === "authorized_user") {
    const missing = VERTEX_ADC_FIELDS.filter((field) => !parsed[field]);
    return {
      kind: VERTEX_CREDENTIAL.ADC,
      json: parsed,
      error: missing.length ?
      `Vertex: ADC authorized_user JSON is missing ${missing.join(", ")}` :
      null
    };
  }

  return {
    kind: VERTEX_CREDENTIAL.UNSUPPORTED,
    json: parsed,
    error: vertexUnsupportedCredentialMessage(parsed)
  };
}

export function validateVertexSaKey(saJson) {
  if (!saJson?.private_key) return "Vertex: service account JSON missing private_key";

  let key;
  try {
    key = createPrivateKey(saJson.private_key.replace(/\\n/g, "\n"));
  } catch {
    return "Vertex: service account private_key is not a valid PEM key";
  }

  if (key.asymmetricKeyType !== "rsa") {
    return `Vertex: service account private_key must be RSA (got ${key.asymmetricKeyType})`;
  }

  const bits = key.asymmetricKeyDetails?.modulusLength || 0;
  return bits < 2048 ?
  `Vertex: service account private_key must be RSA-2048 or larger (RS256), got ${bits} bits` :
  null;
}

// Cache only digests of the complete credential and effective egress route.
const vertexTokenCache = new Map();

export async function refreshVertexToken(saJson, log, proxyOptions = null) {
  const keyError = validateVertexSaKey(saJson);
  if (keyError) {
    log?.error?.("TOKEN_REFRESH", keyError);
    return null;
  }

  const cacheKey = digestMemoryKey("vertex-token", JSON.stringify(saJson), proxyRouteFingerprint(proxyOptions));
  const cached = vertexTokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return { accessToken: cached.token, expiresAt: cached.expiresAt };
  }
  vertexTokenCache.delete(cacheKey);

  try {
    const { SignJWT, importPKCS8 } = await import("jose");
    log?.debug?.("TOKEN_REFRESH", "Vertex minting token");
    const privateKey = await importPKCS8(saJson.private_key.replace(/\\n/g, "\n"), "RS256");
    const now = Math.floor(Date.now() / 1000);

    const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform" }).
    setProtectedHeader({ alg: "RS256" }).
    setIssuer(saJson.client_email).
    setAudience(OAUTH_ENDPOINTS.google.token).
    setIssuedAt(now).
    setExpirationTime(now + 3600).
    sign(privateKey);

    const res = await proxyAwareFetch(OAUTH_ENDPOINTS.google.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt
      })
    }, proxyOptions);

    if (!res.ok) {
      log?.error?.("TOKEN_REFRESH", `Vertex token mint failed (HTTP ${res.status})`);
      return null;
    }

    const { access_token, expires_in } = await res.json();
    const expiresAt = Date.now() + (expires_in ?? 3600) * 1000;

    if (vertexTokenCache.size >= 256) vertexTokenCache.delete(vertexTokenCache.keys().next().value);
    vertexTokenCache.set(cacheKey, { token: access_token, expiresAt });
    log?.info?.("TOKEN_REFRESH", "Vertex token minted");

    return { accessToken: access_token, expiresAt };
  } catch {
    log?.error?.("TOKEN_REFRESH", "Vertex token mint failed");
    return null;
  }
}

function vertexRefreshHandler(c, log, proxyOptions) {
  const saJson = parseVertexSaJson(c.apiKey);
  if (!saJson) return null;
  return refreshVertexToken(saJson, log, proxyOptions);
}

async function refreshAntigravityProvider(provider, credentials, log, proxyOptions) {
  const connectionId = credentials?.connectionId || credentials?._connection?.id || credentials?.id;
  const client = PROVIDERS[provider];
  if (!connectionId) {
    // A refresh token without a connection ID cannot be fenced across processes.
    return null;
  }
  // Same blocked shape as a lease refusal; no lease, request, or write happens.
  const providerSpecificData = credentials?.providerSpecificData ?? credentials?._connection?.providerSpecificData;
  if (antigravityClientBindingBlocks(provider, providerSpecificData, client?.clientId)) {
    return { blocked: true, category: "reauth_required" };
  }
  const { exchangeAntigravityRefresh } = await import("../../src/lib/antigravity/refreshProtocol.js");
  const { refreshGoogleTokenDetailed } = await import("./tokenRefresh/providers.js");
  return exchangeAntigravityRefresh({
    connectionId,
    credentials: { ...credentials, provider, id: connectionId },
    dispatch: () => refreshGoogleTokenDetailed(credentials.refreshToken, client.clientId, client.clientSecret, log, proxyOptions),
  });
}

const REFRESH_HANDLERS = {
  openference: (c, log, p) => refreshOpenferenceToken(c, log, p),
  cursor: (c, log, p) => refreshCursorToken(c.refreshToken, log, p),
  "gemini-cli": (c, log, p) => refreshGoogleToken(c.refreshToken, PROVIDERS["gemini-cli"].clientId, PROVIDERS["gemini-cli"].clientSecret, log, p),
  antigravity: (c, log, p) => refreshAntigravityProvider("antigravity", c, log, p),
  agy: (c, log, p) => refreshAntigravityProvider("agy", c, log, p),
  claude: (c, log, p) => refreshClaudeOAuthToken(c.refreshToken, log, p),
  codex: (c, log, p) => refreshCodexToken(c.refreshToken, log, p, c._connection?.id ?? c.id, resolveCodexAccountId(c.providerSpecificData ?? c._connection?.providerSpecificData, c.idToken ?? c._connection?.idToken)),
  qwen: (c, log, p) => refreshQwenToken(c.refreshToken, log, p),
  iflow: (c, log, p) => refreshIflowToken(c.refreshToken, log, p),
  github: (c, log, p) => refreshGitHubToken(c.refreshToken, log, p),
  // Every GHE endpoint lives on the connection's own host, so the generic
  // refresh path (which reads a static registry tokenUrl) cannot serve it.
  "ghe-copilot": (c, log, p) => refreshBoundGheCopilotCredentials(c, log, p),
  kiro: (c, log, p) => refreshKiroToken(c.refreshToken, c.providerSpecificData, log, p),
  "amazon-q": (c, log, p) => refreshKiroToken(c.refreshToken, c.providerSpecificData, log, p),
  xai: (c, log, p) => refreshXaiToken(c.refreshToken, log, p),
  "grok-cli": (c, log, p) => refreshXaiToken(c.refreshToken, log, p),
  "kimi-coding": (c, log, p) => refreshKimiToken("kimi-coding", c, log, p),
  "kimi-ai": (c, log, p) => refreshKimiToken("kimi-ai", c, log, p),
  "codebuddy-cn": (c, log, p) => refreshCodebuddyToken(c.refreshToken, log, p),
  "gitlab-duo": (c, log, p) => refreshGitLabDuoToken(c.refreshToken, c, log, p),
  // Cline and ClinePass share the same WorkOS-backed refresh endpoint. Without
  // these entries the proactive refresh path fell through to the generic
  // form-encoded OAuth grant, which api.cline.bot rejects, so expired tokens
  // were never rotated. Ported from decolua/9router f6e7cabe.
  cline: (c, log, p) => refreshClineToken(c.refreshToken, log, p),
  clinepass: (c, log, p) => refreshClineToken(c.refreshToken, log, p),
  // Microsoft 365 Copilot native sign-in: per-connection refresh against the connection's own tenant.
  // A pasted session has no refresh token and never reaches this handler.
  "copilot-m365-web": (c, log, p) => refreshM365Token(c, log, p),
  // OrcaRouter's PKCE login returns a durable API key, not a refreshable token —
  // OrcaRouter publishes no refresh grant. Refusing explicitly (rather than
  // omitting the provider) also keeps `refreshTokenByProvider` from falling
  // through to the generic refresh path, which would POST a fabricated
  // grant_type=refresh_token to /api/v1/auth/keys. A revoked key must be
  // reauthenticated through the connect flow, not refreshed.
  orcarouter: () => null,
  // Muse Code has no refresh grant: the stored dca token remints the key.
  "muse-code": (c, log, p) => refreshMuseCodeToken(c.refreshToken, c.providerSpecificData, log, p),
  // MiniMax Code and WorkBuddy refresh against their own account hosts; neither
  // has a registry tokenUrl the generic grant could use. A connection that has
  // not opted in to dispatch never spends (and rotates) its refresh token.
  "minimax-code": (c, log, p) => c.providerSpecificData?.enableSessionDispatch === true ? refreshMinimaxCodeToken(c, log, p) : null,
  workbuddy: (c, log, p) => c.providerSpecificData?.enableSessionDispatch === true ? refreshWorkbuddyToken(c, log, p) : null,
  // Devin session tokens carry no refresh grant; a rejected one means sign in again.
  "devin-desktop": () => null,
  // RenderHour plan sign-in: rotating single-use refresh tokens on a fixed
  // origin. An rh_ API key has no refresh token and never reaches this handler.
  renderhour: (c, log, p) => createRenderHourRefreshHooks().refreshCredentials(c, log, p),
  vertex: vertexRefreshHandler,
  "vertex-partner": vertexRefreshHandler
};

export async function getAccessToken(provider, credentials, log, proxyOptions = null) {
  if (!credentials || !credentials.refreshToken || !isString(credentials.refreshToken)) {
    log?.warn?.("TOKEN_REFRESH", `No valid refresh token available for provider: ${provider}`);
    return null;
  }
  return _getAccessTokenInternal(provider, credentials, log, proxyOptions);
}

async function _getAccessTokenInternal(provider, credentials, log, proxyOptions) {
  if (provider === "gemini") {
    return refreshGoogleToken(credentials.refreshToken, PROVIDERS.gemini.clientId, PROVIDERS.gemini.clientSecret, log, proxyOptions);
  }
  const handler = REFRESH_HANDLERS[provider];
  if (!handler) {
    log?.warn?.("TOKEN_REFRESH", `Unsupported provider for token refresh: ${provider}`);
    return null;
  }
  return handler(credentials, log, proxyOptions);
}

/**
 * Refresh credentials using the caller's immutable egress contract.
 * `proxyOptions` is intentionally trailing so existing integrations remain
 * source-compatible while proactive and reactive refresh paths can opt in.
 */
export async function refreshTokenByProvider(provider, credentials, log, proxyOptions = null) {
  if (!credentials.refreshToken) return null;
  const handler = REFRESH_HANDLERS[provider];
  return handler ?
  handler(credentials, log, proxyOptions) :
  refreshAccessToken(provider, credentials.refreshToken, credentials, log, proxyOptions);
}

export function formatProviderCredentials(provider, credentials, log) {
  const config = PROVIDERS[provider];
  if (!config) {
    log?.warn?.("TOKEN_REFRESH", `No configuration found for provider: ${provider}`);
    return null;
  }

  switch (provider) {
    case "gemini":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        projectId: credentials.projectId
      };

    case "claude":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "codex":
    case "qwen":
    case "iflow":
    case "openai":
    case "openrouter":
    case "xai":
    case "grok-cli":
    case "orcarouter":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "antigravity":
    case "agy":
    case "gemini-cli":
      return {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        projectId: credentials.projectId
      };

    default:
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken
      };
  }
}

export async function getAllAccessTokens(userInfo, log) {
  const results = {};

  if (userInfo.connections && Array.isArray(userInfo.connections)) {
    for (const connection of userInfo.connections) {
      if (connection.isActive && connection.provider) {
        const token = await getAccessToken(connection.provider, {
          refreshToken: connection.refreshToken
        }, log);

        if (token) {
          results[connection.provider] = token;
        }
      }
    }
  }

  return results;
}

const TRANSIENT_REFRESH_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET"]);

function isTransientRefreshError(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  return TRANSIENT_REFRESH_CODES.has(error?.code) ||
  TRANSIENT_REFRESH_CODES.has(error?.cause?.code) ||
  status >= 500 && status < 600;
}

export async function refreshWithRetry(refreshFn, maxRetries = 3, log = null) {
  let attempt = 0;
  let immediateRetries = 0;

  while (attempt < maxRetries) {
    if (attempt > 0) {
      const delay = attempt * 1000;
      log?.debug?.("TOKEN_REFRESH", `Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const result = await refreshFn();
      if (result) return result;
      attempt += 1;
    } catch (error) {
      if (isTransientRefreshError(error) && immediateRetries < 3) {
        immediateRetries += 1;
        log?.debug?.("TOKEN_REFRESH", `Immediate retry ${immediateRetries}/3 after transient error`);
        continue;
      }
      attempt += 1;
      log?.warn?.(
        "TOKEN_REFRESH",
        `Attempt ${attempt}/${maxRetries} failed: ${sanitizeErrorMessage(error?.message || error)}`
      );
    }
  }

  log?.error?.("TOKEN_REFRESH", `All ${maxRetries} retry attempts failed`);
  return null;
}
