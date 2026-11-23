import { PROVIDERS, PROVIDER_OAUTH } from "../../config/providers.js";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT, buildKimiDeviceHeaders, buildKimiHeaders, getKimiOAuthClientId } from "../../config/appConstants.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { buildKiroOidcEndpoint, KIRO_DEFAULT_REGION } from "../../config/kiroRegions.js";
import { dedupRefresh } from "./dedup.js";
import { buildExternalIdpRefreshParams } from "../../../src/lib/oauth/kiroExternalIdp.js";
import { sanitizeErrorMessage } from "../../utils/error.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { getClineAccessToken } from "../../shared/clineAuth.js";
import { digestMemoryKey } from "../../utils/memoryKey.js";

function safeRefreshError(value) {
  if (isString(value)) return sanitizeErrorMessage(value);
  if (value?.message) return sanitizeErrorMessage(value.message);
  try {
    return sanitizeErrorMessage(JSON.stringify(value));
  } catch {
    return sanitizeErrorMessage(value);
  }
}

let _xaiServiceSingleton = null;
export async function refreshXaiToken(refreshToken, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh("xai", refreshToken, async () => {
    try {
      if (!_xaiServiceSingleton) {
        const mod = await import("../../../src/lib/oauth/services/xai.js");
        _xaiServiceSingleton = new mod.XaiService();
      }
      const tokens = await _xaiServiceSingleton.refreshAccessToken(refreshToken, proxyOptions);
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: tokens.expires_in,
        idToken: tokens.id_token
      };
    } catch (e) {
      log?.warn?.("TOKEN_REFRESH", `xai refresh failed: ${safeRefreshError(e?.message || e)}`);
      const msg = String(e?.message || "");
      if (msg.includes("invalid_grant") || msg.includes("invalid_request")) {
        return { error: "invalid_grant" };
      }
      return null;
    }
  }, log, proxyOptions);
}

export async function refreshAccessToken(provider, refreshToken, credentials, log, proxyOptions = null) {
  if (provider === "codex") {
    return refreshCodexToken(refreshToken, log, proxyOptions, credentials?._connection?.id ?? credentials?.id);
  }
  const config = PROVIDERS[provider];

  if (!config || !config.refreshUrl) {
    log?.warn?.("TOKEN_REFRESH", `No refresh URL configured for provider: ${safeRefreshError(provider)}`);
    return null;
  }

  if (!refreshToken) {
    log?.warn?.("TOKEN_REFRESH", `No refresh token available for provider: ${safeRefreshError(provider)}`);
    return null;
  }

  return dedupRefresh(provider, refreshToken, async () => {
    try {
      const response = await proxyAwareFetch(config.refreshUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret
        })
      }, proxyOptions);

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", `Failed to refresh token for ${safeRefreshError(provider)}`, {
          status: response.status,
          error: safeRefreshError(errorText)
        });
        return null;
      }

      const tokens = await response.json();

      log?.info?.("TOKEN_REFRESH", `Successfully refreshed token for ${provider}`, {
        hasNewAccessToken: !!tokens.access_token,
        hasNewRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in
      });

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: tokens.expires_in
      };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", `Error refreshing token for ${safeRefreshError(provider)}`, {
        error: safeRefreshError(error)
      });
      return null;
    }
  }, log, proxyOptions);
}

export async function refreshKimiToken(provider, credentials, log, proxyOptions = null) {
  const { refreshToken, providerSpecificData } = credentials;
  if (!refreshToken) return null;

  return dedupRefresh(provider, refreshToken, async () => {
    try {
      const deviceId = providerSpecificData?.deviceId;
      const response = await proxyAwareFetch(PROVIDERS[provider].refreshUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          ...(deviceId ? buildKimiDeviceHeaders(deviceId) : buildKimiHeaders())
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: getKimiOAuthClientId(provider)
        }),
        redirect: "error"
      }, proxyOptions);
      if (!response.ok) return null;

      const tokens = await response.json();
      if (!tokens?.access_token) return null;
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: tokens.expires_in
      };
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", `Kimi refresh failed: ${safeRefreshError(error)}`);
      return null;
    }
  }, log, proxyOptions);
}

export async function refreshGitLabDuoToken(refreshToken, credentials = {}, log, proxyOptions = null) {
  if (!refreshToken) return null;
  const baseUrl = String(
    credentials?.providerSpecificData?.baseUrl ||
    process.env.GITLAB_DUO_BASE_URL ||
    process.env.GITLAB_BASE_URL ||
    "https://gitlab.com"
  ).replace(/\/$/, "");
  const clientId =
  credentials?.providerSpecificData?.clientId ||
  process.env.GITLAB_DUO_OAUTH_CLIENT_ID ||
  process.env.GITLAB_OAUTH_CLIENT_ID ||
  PROVIDER_OAUTH["gitlab-duo"]?.clientId ||
  "";
  const clientSecret =
  process.env.GITLAB_DUO_OAUTH_CLIENT_SECRET ||
  process.env.GITLAB_OAUTH_CLIENT_SECRET ||
  PROVIDER_OAUTH["gitlab-duo"]?.clientSecret ||
  "";

  return dedupRefresh(`gitlab-duo:${baseUrl}:${clientId}`, refreshToken, async () => {
    try {
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId
      });
      if (clientSecret) params.set("client_secret", clientSecret);
      const response = await proxyAwareFetch(`${baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: params
      }, proxyOptions);
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        log?.warn?.("TOKEN_REFRESH", `GitLab Duo refresh failed: ${response.status} ${safeRefreshError(errorText)}`);
        if (response.status === 400 || response.status === 401) return { error: "invalid_grant" };
        return null;
      }
      const tokens = await response.json();
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: tokens.expires_in,
        providerSpecificData: {
          baseUrl,
          clientId,
          authKind: "oauth"
        }
      };
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", `GitLab Duo refresh error: ${safeRefreshError(error)}`);
      return null;
    }
  }, log, proxyOptions);
}

// OmniRoute's Claude refresher recognizes OAuth errors even through nested or
// JSON-encoded error envelopes. Keep this specific to Claude's grant handling.
const claudeRefreshBlocks = new Map();
function claudeRefreshDelay(headers) {
  const retryAfter = headers.get("retry-after");
  const seconds = Number(retryAfter);
  const date = Date.parse(retryAfter);
  const milliseconds = Number(headers.get("retry-after-ms"));
  const delay = retryAfter && Number.isFinite(seconds) ? seconds * 1000 :
    retryAfter && Number.isFinite(date) ? date - Date.now() :
    headers.has("retry-after-ms") && Number.isFinite(milliseconds) ? milliseconds : 5000;
  return Math.max(5000, Math.min(300000, delay));
}

function claudeRefreshErrorCode(value, depth = 0) {
  if (depth > 6) return null;
  if (isString(value)) {
    const text = value.trim();
    if (/^[{[\"]/.test(text)) {
      try {
        return claudeRefreshErrorCode(JSON.parse(text), depth + 1);
      } catch { return null; }
    }
    return text.match(/\b(invalid_grant|invalid_request)\b/i)?.[1]?.toLowerCase() || null;
  }
  if (!isObject(value)) return null;
  return claudeRefreshErrorCode(value.error, depth + 1) ||
    claudeRefreshErrorCode(value.code, depth + 1) ||
    claudeRefreshErrorCode(value.error_code, depth + 1);
}

export async function refreshClaudeOAuthToken(refreshToken, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh("claude", refreshToken, async () => {
    try {
      const blockKey = digestMemoryKey("claude-refresh-backoff", refreshToken);
      const now = Date.now();
      for (const [key, until] of claudeRefreshBlocks) if (until <= now) claudeRefreshBlocks.delete(key);
      if (claudeRefreshBlocks.get(blockKey) > now) return null;
      // Anthropic's OAuth control plane answers the grant only when the
      // OAuth-only beta is present, and the grant has to name the scope the
      // authorize step obtained — a refresh that omits it can come back
      // down-scoped and drop the Claude Code session and MCP grants. Both
      // come from the registry entry, which is the single source for the
      // Claude OAuth contract.
      // Sources: OmniRoute open-sse/services/tokenRefresh/providers/
      // claudeOAuth.ts (beta header) and CLIProxyAPI
      // internal/auth/claude/anthropic_auth.go (scope on refresh).
      const claudeOauth = PROVIDER_OAUTH.claude || {};
      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.anthropic.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(claudeOauth.refresh?.headers || {})
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: PROVIDERS.claude.clientId,
          ...(claudeOauth.refresh?.scope ? { scope: claudeOauth.refresh.scope } : null)
        })
      }, proxyOptions);

      if (!response.ok) {
        if (response.status === 429) {
          if (claudeRefreshBlocks.size >= 1024) claudeRefreshBlocks.delete(claudeRefreshBlocks.keys().next().value);
          claudeRefreshBlocks.set(blockKey, Date.now() + claudeRefreshDelay(response.headers));
          return null;
        }
        const errorText = await response.text();
        const failure = classifyOAuthRefreshError(errorText, response.status);
        const claudeCode = claudeRefreshErrorCode(errorText);
        if (failure.permanent || claudeCode) {
          log?.error?.("TOKEN_REFRESH", "Claude refresh token already used or invalid. Re-auth required.", {
            status: response.status,
            code: safeRefreshError(claudeCode || failure.code)
          });
          return { error: "unrecoverable_refresh_error", code: claudeCode || failure.code };
        }
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Claude OAuth token", {
          status: response.status,
          error: safeRefreshError(errorText)
        });
        return null;
      }

      const tokens = await response.json();
      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Claude OAuth token", { hasNewAccessToken: !!tokens.access_token, expiresIn: tokens.expires_in });
      return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", `Network error refreshing Claude token: ${safeRefreshError(error)}`);
      return null;
    }
  }, log, proxyOptions);
}

export async function refreshGoogleToken(refreshToken, clientId, clientSecret, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh(`google:${clientId}`, refreshToken, async () => {
    try {
      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        })
      }, proxyOptions);

      if (!response.ok) {
        const errorText = await response.text();
        // Google answers a revoked or expired refresh token with invalid_grant;
        // retrying cannot recover it, so surface the durable re-auth signal
        // (9router #900). invalid_client and transient errors stay retryable.
        const failure = classifyOAuthRefreshError(errorText, response.status);
        if (String(failure.code).toLowerCase() === "invalid_grant") {
          log?.error?.("TOKEN_REFRESH", "Google refresh token revoked or expired. Re-auth required.", {
            status: response.status,
            code: "invalid_grant"
          });
          return { error: "invalid_grant" };
        }
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Google token", {
          status: response.status,
          error: safeRefreshError(errorText)
        });
        return null;
      }

      const tokens = await response.json();
      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Google token", { hasNewAccessToken: !!tokens.access_token, expiresIn: tokens.expires_in });
      return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", `Network error refreshing Google token: ${safeRefreshError(error)}`);
      return null;
    }
  }, log, proxyOptions);
}

export async function refreshQwenToken(refreshToken, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh("qwen", refreshToken, async () => {
    const endpoint = OAUTH_ENDPOINTS.qwen.token;

    try {
      const response = await proxyAwareFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: PROVIDERS.qwen.clientId
        })
      }, proxyOptions);

      if (response.status === 200) {
        const tokens = await response.json();

        log?.info?.("TOKEN_REFRESH", "Successfully refreshed Qwen token", {
          hasNewAccessToken: !!tokens.access_token,
          hasNewRefreshToken: !!tokens.refresh_token,
          expiresIn: tokens.expires_in
        });

        return {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || refreshToken,
          expiresIn: tokens.expires_in,
          providerSpecificData: tokens.resource_url ?
          { resourceUrl: tokens.resource_url } :
          undefined
        };
      } else {
        const errorText = await response.text().catch(() => "");
        log?.warn?.("TOKEN_REFRESH", `Error with Qwen endpoint`, {
          status: response.status,
          error: safeRefreshError(errorText)
        });
      }
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", `Network error trying Qwen endpoint`, {
        error: safeRefreshError(error)
      });
    }

    log?.error?.("TOKEN_REFRESH", "Failed to refresh Qwen token");
    return null;
  }, log, proxyOptions);
}

export function classifyOAuthRefreshError(errorText = "", status = 0) {
  let parsed = null;
  try {
    parsed = errorText ? JSON.parse(errorText) : null;
  } catch {
    parsed = null;
  }

  const code = parsed?.error?.code || parsed?.error || parsed?.error_code || "";
  const description = parsed?.error_description || parsed?.message || errorText || "";
  const combined = `${code} ${description}`.toLowerCase();
  const markerPermanent = [
  "refresh_token_expired",
  "refresh_token_reused",
  "refresh_token_invalidated",
  "invalid_grant",
  // OpenAI's token endpoint rejects a rotated-away or expired refresh token with
  // HTTP 401 {error:{code:"token_expired"}} (9router PR #1821).
  "token_expired",
  "could not validate your token"].
  some((marker) => combined.includes(marker));
  // A 401 from the OAuth token endpoint rejects the refresh credential itself:
  // re-authenticate instead of retrying. 429 and 5xx stay transient.
  const permanent = status === 401 || markerPermanent;

  return { status, code, description, permanent };
}

export async function refreshCodexToken(refreshToken, log, proxyOptions = null, connectionId = null) {
  if (!refreshToken) return null;
  try {
    if (connectionId) {
      const { claimCodexRefreshAttempt } = await import("../../../src/lib/db/repos/connectionsRepo.js");
      const fingerprint = digestMemoryKey("codex-refresh-attempt", PROVIDERS.codex.clientId, refreshToken);
      if (!await claimCodexRefreshAttempt(connectionId, refreshToken, fingerprint)) return null;
    }
  } catch {
    log?.error?.("TOKEN_REFRESH", "Could not record Codex refresh attempt");
    return null;
  }

  async function exchange() {
    try {
      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.openai.token, {
        method: "POST",
        redirect: "error",
        noTransportReplay: true,
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          client_id: PROVIDERS.codex.clientId,
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }, proxyOptions);

      if (!response.ok) {
        const errorText = await response.text();
        const failure = classifyOAuthRefreshError(errorText, response.status);
        if (failure.permanent || failure.code === "invalid_token" || /token_revoked|invalid_client/i.test(errorText)) {
          log?.error?.("TOKEN_REFRESH", "Codex refresh token already used or invalid. Re-auth required.", {
            status: response.status,
            code: safeRefreshError(failure.code)
          });
          return { error: "unrecoverable_refresh_error", code: failure.code };
        }

        log?.error?.("TOKEN_REFRESH", "Failed to refresh Codex token", {
          status: response.status,
          error: safeRefreshError(errorText),
          code: safeRefreshError(failure.code),
          permanent: failure.permanent
        });
        return null;
      }

      const tokens = await response.json();
      if (connectionId && (
        !isString(tokens?.access_token) || !tokens.access_token.trim() ||
        !isString(tokens.refresh_token) || !tokens.refresh_token.trim() || tokens.refresh_token === refreshToken ||
        !Number.isSafeInteger(tokens.expires_in) || tokens.expires_in <= 0
      )) {
        log?.warn?.("TOKEN_REFRESH", "Codex refresh returned an ambiguous token response");
        return null;
      }

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Codex token", {
        hasNewAccessToken: !!tokens.access_token,
        hasNewRefreshToken: !!tokens.refresh_token,
        hasIdToken: !!tokens.id_token,
        expiresIn: tokens.expires_in
      });

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        idToken: tokens.id_token,
        expiresIn: tokens.expires_in
      };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", `Network error refreshing Codex token: ${safeRefreshError(error)}`);
      return null;
    }
  }
  // A persisted grant uses its database claim instead of replaying a cached result.
  return connectionId ? exchange() : dedupRefresh("codex", refreshToken, exchange, log, proxyOptions);
}

async function resolveKiroProfileArnPatch(providerSpecificData, accessToken, refreshedArn, proxyOptions) {
  if (providerSpecificData?.profileArn) return {};
  let profileArn = refreshedArn?.trim?.() || null;
  if (!profileArn) {
    const { fetchKiroProfileArn } = await import("../../../src/lib/oauth/providers.js");
    const region = providerSpecificData?.region || KIRO_DEFAULT_REGION;
    profileArn = await fetchKiroProfileArn(accessToken, region, proxyOptions);
  }
  return profileArn ? { providerSpecificData: { profileArn } } : {};
}

export async function refreshKiroToken(refreshToken, providerSpecificData, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh("kiro", refreshToken, async () => {
    const authMethod = providerSpecificData?.authMethod;
    const clientId = providerSpecificData?.clientId;
    const clientSecret = providerSpecificData?.clientSecret;
    const region = providerSpecificData?.region;

    if (authMethod === "external_idp") {
      let refreshRequest;
      try {
        refreshRequest = buildExternalIdpRefreshParams(refreshToken, providerSpecificData);
      } catch (error) {
        log?.warn?.("TOKEN_REFRESH", `Invalid Kiro external_idp refresh config: ${safeRefreshError(error)}`);
        return null;
      }

      const response = await proxyAwareFetch(refreshRequest.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: refreshRequest.body
      }, proxyOptions);

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Kiro external_idp token", {
          status: response.status,
          error: safeRefreshError(errorText)
        });
        return null;
      }

      const tokens = await response.json();

      if (!tokens || !isString(tokens.access_token) || !tokens.access_token) {
        log?.error?.("TOKEN_REFRESH", "Kiro external_idp refresh response missing access_token");
        return null;
      }

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kiro external_idp token", {
        hasNewAccessToken: !!tokens.access_token,
        hasNewRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in
      });

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: tokens.expires_in,
        providerSpecificData: refreshRequest.providerSpecificData
      };
    }

    if (clientId && clientSecret) {
      const isIDC = authMethod === "idc";
      const endpoint = buildKiroOidcEndpoint(isIDC ? region : KIRO_DEFAULT_REGION);

      const response = await proxyAwareFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          clientId: clientId,
          clientSecret: clientSecret,
          refreshToken: refreshToken,
          grantType: "refresh_token"
        })
      }, proxyOptions);

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Kiro AWS token", {
          status: response.status,
          error: safeRefreshError(errorText)
        });
        return null;
      }

      const tokens = await response.json();

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kiro AWS token", {
        hasNewAccessToken: !!tokens.accessToken,
        expiresIn: tokens.expiresIn
      });

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || refreshToken,
        expiresIn: tokens.expiresIn,
        ...(await resolveKiroProfileArnPatch(providerSpecificData, tokens.accessToken, tokens.profileArn, proxyOptions))
      };
    }

    const response = await proxyAwareFetch(PROVIDERS.kiro.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "kiro-cli/1.0.0"
      },
      body: JSON.stringify({
        refreshToken: refreshToken
      })
    }, proxyOptions);

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Kiro social token", {
        status: response.status,
        error: safeRefreshError(errorText)
      });
      return null;
    }

    const tokens = await response.json();

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kiro social token", {
      hasNewAccessToken: !!tokens.accessToken,
      expiresIn: tokens.expiresIn
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || refreshToken,
      expiresIn: tokens.expiresIn,
      ...(await resolveKiroProfileArnPatch(providerSpecificData, tokens.accessToken, tokens.profileArn, proxyOptions))
    };
  }, log, proxyOptions);
}

export async function refreshIflowToken(refreshToken, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh("iflow", refreshToken, async () => {
    const basicAuth = btoa(`${PROVIDERS.iflow.clientId}:${PROVIDERS.iflow.clientSecret}`);

    const response = await proxyAwareFetch(OAUTH_ENDPOINTS.iflow.token, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${basicAuth}`
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: PROVIDERS.iflow.clientId,
        client_secret: PROVIDERS.iflow.clientSecret
      })
    }, proxyOptions);

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh iFlow token", {
        status: response.status,
        error: safeRefreshError(errorText)
      });
      return null;
    }

    const tokens = await response.json();

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed iFlow token", {
      hasNewAccessToken: !!tokens.access_token,
      hasNewRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in
    };
  }, log, proxyOptions);
}

export async function refreshGitHubToken(refreshToken, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh("github", refreshToken, async () => {
    const params = {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: PROVIDERS.github.clientId
    };
    if (PROVIDERS.github.clientSecret) {
      params.client_secret = PROVIDERS.github.clientSecret;
    }

    const response = await proxyAwareFetch(OAUTH_ENDPOINTS.github.token, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams(params)
    }, proxyOptions);

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh GitHub token", {
        status: response.status,
        error: safeRefreshError(errorText)
      });
      return null;
    }

    const tokens = await response.json();

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed GitHub token", {
      hasNewAccessToken: !!tokens.access_token,
      hasNewRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in
    };
  }, log, proxyOptions);
}

export async function refreshCopilotToken(githubAccessToken, log, proxyOptions = null) {
  if (!githubAccessToken) return null;
  return dedupRefresh("copilot", githubAccessToken, async () => {
    try {
      const response = await proxyAwareFetch(PROVIDER_OAUTH["github"]?.copilotTokenUrl, {
        headers: {
          "Authorization": `token ${githubAccessToken}`,
          "User-Agent": GITHUB_COPILOT.USER_AGENT,
          "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
          "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
          "Accept": "application/json",
          "x-github-api-version": GITHUB_COPILOT.API_VERSION
        }
      }, proxyOptions);

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Copilot token", {
          status: response.status,
          error: safeRefreshError(errorText)
        });
        return null;
      }

      const data = await response.json();

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Copilot token", {
        hasToken: !!data.token,
        expiresAt: data.expires_at
      });

      return {
        token: data.token,
        expiresAt: data.expires_at
      };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", "Error refreshing Copilot token", {
        error: safeRefreshError(error)
      });
      return null;
    }
  }, log, proxyOptions);
}

// CodeBuddy (Tencent) refresh — POST /v2/plugin/auth/token/refresh with the
// refresh token carried in the X-Refresh-Token header (not a form body),
// matching the official CodeBuddy CLI. Response: { code: 0, data: <token> }.
export async function refreshCodebuddyToken(refreshToken, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh("codebuddy-cn", refreshToken, async () => {
    const oauth = PROVIDER_OAUTH["codebuddy-cn"] || {};
    const response = await proxyAwareFetch(oauth.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": oauth.userAgent,
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "copilot.tencent.com",
        "X-Refresh-Token": refreshToken,
        "X-Auth-Refresh-Source": "plugin",
        "X-Product": "SaaS"
      },
      body: "{}"
    }, proxyOptions);

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh CodeBuddy token", {
        status: response.status,
        error: safeRefreshError(errorText)
      });
      return null;
    }

    const data = await response.json();
    if (data.code !== 0 || !data.data?.accessToken) {
      log?.error?.("TOKEN_REFRESH", "CodeBuddy token refresh returned no token", {
        code: data.code,
        msg: safeRefreshError(data.msg)
      });
      return null;
    }

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed CodeBuddy token", {
      hasNewAccessToken: !!data.data.accessToken,
      hasNewRefreshToken: !!data.data.refreshToken,
      expiresIn: data.data.expiresIn
    });

    return {
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken || refreshToken,
      expiresIn: data.data.expiresIn
    };
  }, log, proxyOptions);
}

// Cline / ClinePass refresh — POST /api/v1/auth/refresh with a JSON body
// `{ refreshToken, grantType, clientType }`. The generic OAuth form-encoded
// grant is NOT accepted here, so the proactive service path needs its own
// handler; without it expired ClinePass tokens were never rotated and every
// request kept 401ing. Response: `{ data: { accessToken, refreshToken,
// expiresAt } }` (or the same fields at the top level).
//
// Ported from decolua/9router f6e7cabe.
export async function refreshClineToken(refreshToken, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh("cline", refreshToken, async () => {
    const response = await proxyAwareFetch(PROVIDERS.cline.refreshUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken, grantType: "refresh_token", clientType: "extension" })
    }, proxyOptions);

    if (!response.ok) {
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Cline token", { status: response.status });
      return null;
    }

    const payload = await response.json();
    const data = payload?.data || payload;
    if (!data?.accessToken) return null;

    const expiresAtMs = data.expiresAt ? new Date(data.expiresAt).getTime() : NaN;
    const expiresIn = Number.isFinite(expiresAtMs) ?
    Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000)) :
    undefined;

    return {
      accessToken: getClineAccessToken(data.accessToken),
      refreshToken: data.refreshToken || refreshToken,
      expiresIn
    };
  }, log, proxyOptions);
}
