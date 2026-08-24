import { PROVIDERS, PROVIDER_OAUTH } from "../../config/providers.js";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT } from "../../config/appConstants.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { buildKiroOidcEndpoint, KIRO_DEFAULT_REGION } from "../../config/kiroRegions.js";
import { dedupRefresh } from "./dedup.js";
import { buildExternalIdpRefreshParams } from "../../../src/lib/oauth/kiroExternalIdp.js";
import { sanitizeErrorMessage } from "../../utils/error.js";
import { isString } from "@/shared/utils/typeChecks.js";

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

export async function refreshClaudeOAuthToken(refreshToken, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh("claude", refreshToken, async () => {
    try {
      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.anthropic.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: PROVIDERS.claude.clientId
        })
      }, proxyOptions);

      if (!response.ok) {
        const errorText = await response.text();
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
  const permanent = [
  "refresh_token_expired",
  "refresh_token_reused",
  "refresh_token_invalidated",
  "invalid_grant"].
  some((marker) => combined.includes(marker));

  return { status, code, description, permanent };
}

export async function refreshCodexToken(refreshToken, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh("codex", refreshToken, async () => {
    try {
      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.openai.token, {
        method: "POST",
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
        if (failure.permanent) {
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
  }, log, proxyOptions);
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