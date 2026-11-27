import { buildKiroIdentityHeaders } from "../../../../open-sse/shared/kiroHeaders.js";
import { KIRO_CONFIG, assertValidAwsRegion } from "../constants/oauth.js";
import { buildKiroProfileEndpoint, regionFromProfileArn } from "../../../../open-sse/config/kiroRegions.js";
import { buildExternalIdpRefreshParams } from "../kiroExternalIdp.js";

/**
 * Kiro OAuth Service
 * Supports multiple authentication methods:
 * 1. AWS Builder ID (Device Code Flow)
 * 2. AWS IAM Identity Center/IDC (Device Code Flow)
 * 3. Google/GitHub Social Login (Authorization Code Flow + Manual Callback)
 * 4. Import Token (Manual refresh token paste)
 */
import { isString } from "../../../shared/utils/typeChecks.js";

const KIRO_AUTH_SERVICE = "https://prod.us-east-1.auth.desktop.kiro.dev";
const KIRO_SOCIAL_CLIENT_ID = "kiro-cli";

function socialProvider(provider) {
  if (!["google", "github"].includes(provider)) throw new Error("Unsupported Kiro social provider");
  return provider === "google" ? "Google" : "Github";
}

function requireAccessToken(data, field = "accessToken") {
  if (!isString(data?.[field]) || !data[field].trim()) throw new Error("Invalid Kiro token response");
}

async function kiroJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("Invalid Kiro response");
  }
}

/** Bound provider calls and keep transport errors free of credentials. No automatic retries. */
async function kiroFetch(url, options) {
  try {
    return await fetch(url, { ...options, redirect: "error", signal: options.signal ?? AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("Kiro request failed");
  }
}

export class KiroService {
  /** Start social device authorization; retain the device code server-side. */
  async startSocialDevice(provider, proxyOptions = null) {
    const response = await kiroFetch(`${KIRO_AUTH_SERVICE}/oauth/device/authorization`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: KIRO_SOCIAL_CLIENT_ID, loginProvider: socialProvider(provider) }),
      proxyOptions
    });
    if (!response.ok) throw new Error("Social device authorization failed");
    const data = await kiroJson(response);
    if (!data.deviceCode || !data.verificationUriComplete) throw new Error("Invalid social device authorization response");
    return data;
  }

  /** Poll a server-bound social device code, preserving pending and slow_down. */
  async pollSocialDevice(deviceCode, proxyOptions = null) {
    const response = await kiroFetch(`${KIRO_AUTH_SERVICE}/oauth/device/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode, clientId: KIRO_SOCIAL_CLIENT_ID }),
      proxyOptions
    });
    const data = await kiroJson(response);
    const progress = data.error ?? data.status;
    if (progress === "authorization_pending" || progress === "slow_down") return { pending: true, error: progress };
    if (!response.ok || data.error || !data.accessToken) throw new Error("Social device authorization failed");
    requireAccessToken(data);
    return { ...data, pending: false };
  }
  /**
   * Register OIDC client with AWS SSO
   * Returns clientId and clientSecret for device code flow
   */
  async registerClient(region = "us-east-1", proxyOptions = null) {
    assertValidAwsRegion(region);
    const endpoint = `https://oidc.${region}.amazonaws.com/client/register`;

    const response = await kiroFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientName: KIRO_CONFIG.clientName,
        clientType: KIRO_CONFIG.clientType,
        scopes: KIRO_CONFIG.scopes,
        grantTypes: KIRO_CONFIG.grantTypes,
        issuerUrl: KIRO_CONFIG.issuerUrl
      }),
      proxyOptions
    });

    if (!response.ok) {
      throw new Error("Failed to register client");
    }

    const data = await kiroJson(response);
    return {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      clientSecretExpiresAt: data.clientSecretExpiresAt
    };
  }

  /**
   * Start device authorization for AWS Builder ID or IDC
   */
  async startDeviceAuthorization(clientId, clientSecret, startUrl, region = "us-east-1", proxyOptions = null) {
    assertValidAwsRegion(region);
    const endpoint = `https://oidc.${region}.amazonaws.com/device_authorization`;

    const response = await kiroFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        startUrl
      }),
      proxyOptions
    });

    if (!response.ok) {
      throw new Error("Failed to start device authorization");
    }

    const data = await kiroJson(response);
    return {
      deviceCode: data.deviceCode,
      userCode: data.userCode,
      verificationUri: data.verificationUri,
      verificationUriComplete: data.verificationUriComplete,
      expiresIn: data.expiresIn,
      interval: data.interval || 5
    };
  }

  /**
   * Poll for token using device code (AWS Builder ID/IDC)
   */
  async pollDeviceToken(clientId, clientSecret, deviceCode, region = "us-east-1", proxyOptions = null) {
    assertValidAwsRegion(region);
    const endpoint = `https://oidc.${region}.amazonaws.com/token`;

    const response = await kiroFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        deviceCode,
        grantType: "urn:ietf:params:oauth:grant-type:device_code"
      }),
      proxyOptions
    });

    const data = await kiroJson(response);

    // Handle pending/slow_down/errors
    if (!response.ok || data.error) {
      return {
        success: false,
        error: ["authorization_pending", "slow_down", "expired_token", "access_denied"].includes(data.error) ? data.error : "authorization_failed",
        errorDescription: "Kiro device authorization failed",
        pending: data.error === "authorization_pending" || data.error === "slow_down"
      };
    }

    requireAccessToken(data);
    return {
      success: true,
      tokens: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn,
        tokenType: data.tokenType
      }
    };
  }

  /**
   * Build Google/GitHub social login URL
   * Returns authorization URL for manual callback flow
   * Uses kiro:// custom protocol as required by AWS Cognito whitelist
   */
  buildSocialLoginUrl(provider, codeChallenge, state) {
    const idp = socialProvider(provider);
    // AWS Cognito only whitelists kiro:// protocol, not localhost
    const redirectUri = "kiro://kiro.kiroAgent/authenticate-success";
    return `${KIRO_AUTH_SERVICE}/login?idp=${idp}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}&prompt=select_account`;
  }

  /**
   * Exchange authorization code for tokens (Social Login)
   * Must use same redirect_uri as authorization request
   */
  async exchangeSocialCode(code, codeVerifier, proxyOptions = null) {
    // Must match the redirect_uri used in buildSocialLoginUrl
    const redirectUri = "kiro://kiro.kiroAgent/authenticate-success";

    const response = await kiroFetch(`${KIRO_AUTH_SERVICE}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri
      }),
      proxyOptions
    });

    if (!response.ok) {
      throw new Error("Token exchange failed");
    }

    const data = await kiroJson(response);
    requireAccessToken(data);
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      profileArn: data.profileArn,
      expiresIn: data.expiresIn || 3600
    };
  }

  /**
   * Refresh token using refresh token
   */
  async refreshToken(refreshToken, providerSpecificData = {}, proxyOptions = null) {
    const { authMethod, clientId, clientSecret, region } = providerSpecificData;
    if (authMethod && !["builder-id", "idc", "social", "google", "github", "imported", "external_idp"].includes(authMethod)) {
      throw new Error("Unsupported Kiro refresh method");
    }
    if (!isString(refreshToken) || !refreshToken.trim()) throw new Error("Kiro refresh token is required");
    if (["builder-id", "idc"].includes(authMethod) && (!clientId || !clientSecret)) {
      throw new Error("Kiro OIDC client registration is required");
    }

    // Microsoft Entra ID (external_idp) refresh — ported from 9router PR
    // #2615. Must run before the AWS SSO OIDC branch: external_idp tokens
    // are rejected by AWS endpoints.
    if (authMethod === "external_idp") {
      const refreshRequest = buildExternalIdpRefreshParams(refreshToken, providerSpecificData);

      const response = await kiroFetch(refreshRequest.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: refreshRequest.body,
        proxyOptions
      });

      if (!response.ok) {
        throw new Error("Token refresh failed for external_idp");
      }

      const data = await kiroJson(response);
      if (!data || !isString(data.access_token) || !data.access_token) {
        throw new Error("Token refresh failed for external_idp: response missing access_token");
      }
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresIn: data.expires_in,
        // Merge the normalized provider metadata (region, profileArn,
        // provider label) over the validated refresh fields so the import
        // route persists the full external_idp identity.
        providerSpecificData: {
          ...providerSpecificData,
          ...refreshRequest.providerSpecificData
        }
      };
    }

    // AWS SSO OIDC refresh (Builder ID or IDC)
    // Imported social refresh tokens can carry an unrelated OIDC registration.
    if (clientId && clientSecret && authMethod !== "imported") {
      const safeRegion = region || "us-east-1";
      assertValidAwsRegion(safeRegion);
      const endpoint = `https://oidc.${safeRegion}.amazonaws.com/token`;

      const response = await kiroFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken,
          grantType: "refresh_token"
        }),
        proxyOptions
      });

      if (!response.ok) {
        throw new Error("Token refresh failed");
      }

      const data = await kiroJson(response);
      requireAccessToken(data);
      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || refreshToken,
        profileArn: data.profileArn,
        expiresIn: data.expiresIn || 3600
      };
    }

    // Social auth refresh (Google/GitHub)
    const response = await kiroFetch(`${KIRO_AUTH_SERVICE}/refreshToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        refreshToken
      }),
      proxyOptions
    });

    if (!response.ok) {
      throw new Error("Token refresh failed");
    }

    const data = await kiroJson(response);
    requireAccessToken(data);
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      profileArn: data.profileArn,
      expiresIn: data.expiresIn || 3600
    };
  }

  /**
   * Validate and import refresh token
   */
  async validateImportToken(refreshToken, proxyOptions = null) {
    // Validate token format
    if (!isString(refreshToken) || !refreshToken.startsWith("aorAAAAAG")) {
      throw new Error("Invalid token format. Token should start with aorAAAAAG...");
    }

    // Try to refresh to validate
    try {
      const result = await this.refreshToken(refreshToken, {}, proxyOptions);
      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken || refreshToken,
        profileArn: result.profileArn,
        expiresIn: result.expiresIn,
        authMethod: "imported"
      };
    } catch (error) {
      throw new Error(`Token validation failed: ${error.message}`);
    }
  }

  /**
   * List available CodeWhisperer profiles for a token (or API key) and return
   * the best-matching profileArn. AWS SSO OIDC logins return no profileArn, so
   * it must be fetched separately — the same call works for API-key auth.
   * Accepts both `arn` and `profileArn` response field names (the API-key
   * JSON-1.0 surface returns `arn`).
   *
   * The Q Developer profile can live in a different region than the caller's
   * IAM Identity Center (Q Developer is not hosted in every SSO region), and the
   * legacy codewhisperer.* host only exists in us-east-1 (every other region uses
   * q.<region>). Try the requested region first, then the known Q Developer
   * regions, and return the first profile found (preferring one whose region
   * matches the queried region). port(upstream): #2355.
   */
  async listAvailableProfiles(accessToken, region = "us-east-1", proxyOptions = null, isApiKey = false) {
    // Trust boundary: the requested region is interpolated into the control-plane
    // host. Reject anything that is not a valid AWS region id (SSRF guard).
    assertValidAwsRegion(region);
    const candidates = [...new Set([region, "us-east-1", "eu-central-1"])];
    let lastError = null;
    for (const r of candidates) {
      try {
        const response = await kiroFetch(buildKiroProfileEndpoint(r), {
          method: "POST",
          headers: {
            "Content-Type": "application/x-amz-json-1.0",
            ...buildKiroIdentityHeaders({ accessToken }),
            "x-amz-target": "AmazonCodeWhispererService.ListAvailableProfiles",
            "Authorization": `Bearer ${accessToken}`,
            ...(isApiKey ? { tokentype: "API_KEY" } : null),
            "Accept": "application/json"
          },
          body: JSON.stringify({ maxResults: 10 }),
          proxyOptions,
          ...(isApiKey ? { signal: AbortSignal.timeout(10000) } : null)
        });
        if (!response.ok) {
          lastError = new Error("Kiro profile discovery failed");
          continue;
        }
        const data = await kiroJson(response);
        const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
        if (profiles.length === 0) continue;
        const arnOf = (p) => p?.arn || p?.profileArn || null;
        const match = profiles.find((p) => arnOf(p)?.split(":")[3] === r) || profiles[0];
        const arn = arnOf(match);
        if (arn) return arn;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  /**
   * Validate API keys on the Amazon Q model surface; profile discovery is
   * optional because valid keys can be denied ListAvailableProfiles.
   */
  async validateApiKey(apiKey, region = "auto", proxyOptions = null) {
    if (!apiKey || !isString(apiKey) || !apiKey.trim()) {
      throw new Error("API key is required");
    }
    const trimmed = apiKey.trim();

    const requested = isString(region) ? region.trim().toLowerCase() : "";
    if (!["auto", "us-east-1", "eu-central-1"].includes(requested)) {
      throw new Error("Invalid region for Kiro API key");
    }
    const candidates = requested === "auto" ? ["us-east-1", "eu-central-1"] : [requested];
    let selectedRegion = null;
    for (const candidate of candidates) {
      let response;
      try {
        response = await kiroFetch(`https://q.${candidate}.amazonaws.com/ListAvailableModels?origin=AI_EDITOR`, {
          method: "GET",
          headers: {
            ...buildKiroIdentityHeaders({ accessToken: trimmed }),
            Authorization: `Bearer ${trimmed}`,
            tokentype: "API_KEY",
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(10000),
          proxyOptions
        });
      } catch {
        continue;
      }
      await response.body?.cancel().catch(() => {});
      if (response.ok) { selectedRegion = candidate; break; }
    }
    if (!selectedRegion) throw new Error("API key validation failed: Amazon Q rejected the key or was unavailable");

    let profileArn = null;
    try { profileArn = await this.listAvailableProfiles(trimmed, selectedRegion, proxyOptions, true); } catch { /* optional */ }
    if (profileArn && regionFromProfileArn(profileArn) !== selectedRegion) profileArn = null;

    return {
      accessToken: trimmed,
      refreshToken: null,
      profileArn,
      region: selectedRegion,
      authMethod: "api_key"
    };
  }

  /**
   * List available models from CodeWhisperer API
   */
  async listAvailableModels(accessToken, profileArn, proxyOptions = null) {
    const endpoint = "https://codewhisperer.us-east-1.amazonaws.com";
    const target = "AmazonCodeWhispererService.ListAvailableModels";

    const response = await kiroFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": target,
        ...buildKiroIdentityHeaders({ accessToken, providerSpecificData: { profileArn } }),
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json"
      },
      body: JSON.stringify({
        origin: "AI_EDITOR",
        profileArn
      }),
      proxyOptions
    });

    if (!response.ok) {
      throw new Error("Failed to list models");
    }

    const data = await kiroJson(response);
    return (data.models || []).map((m) => ({
      id: m.modelId,
      name: m.modelName || m.modelId,
      description: m.description,
      rateMultiplier: m.rateMultiplier,
      rateUnit: m.rateUnit,
      maxInputTokens: m.tokenLimits?.maxInputTokens || 0
    }));
  }

  /**
   * Fetch user email from access token (optional, for display)
   */
  extractEmailFromJWT(accessToken) {
    try {
      const parts = accessToken.split(".");
      if (parts.length !== 3) return null;

      // Decode payload (add padding if needed)
      let payload = parts[1];
      while (payload.length % 4) {
        payload += "=";
      }

      const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      return decoded.email || decoded.preferred_username || decoded.sub;
    } catch {
      return null;
    }
  }
}
