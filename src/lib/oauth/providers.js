/**
 * OAuth Provider Configurations and Handlers
 * Centralized DRY approach for all OAuth providers
 */

// Ensure outbound fetch respects HTTP(S)_PROXY/ALL_PROXY in Node runtime
import "open-sse/index.js";
import { GROK_CLI_PAGER_USER_AGENT, GROK_CLI_VERSION } from "open-sse/config/grokCli.js";
import crypto from "crypto";
import { buildKimiDeviceHeaders } from "open-sse/config/appConstants.js";
import { antigravityOnboardOperationError, extractAntigravityOnboardTier, extractAntigravityProject } from "open-sse/services/antigravityProvisioning.js";
import { readBoundedResponseText } from "open-sse/utils/error.js";

import { generatePKCE, generateState } from "./utils/pkce";
import {
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CONFIG,
  QWEN_CONFIG,
  QODER_CONFIG,
  QODER_CN_CONFIG,
  IFLOW_CONFIG,
  ANTIGRAVITY_CONFIG,
  GITHUB_CONFIG,
  KIRO_CONFIG,
  assertValidAwsRegion,
  CURSOR_CONFIG,
  KIMI_CODING_CONFIG,
  KIMI_AI_CONFIG,
  KILOCODE_CONFIG,
  CLINE_CONFIG,
  CLINEPASS_CONFIG,
  GITLAB_CONFIG,
  GITLAB_DUO_CONFIG,
  TRAE_CONFIG,
  DEVIN_CLI_CONFIG,
  WINDSURF_CONFIG,
  CODEBUDDY_CONFIG,
  KIMCHI_CONFIG,
  GROK_CLI_CONFIG,
  getOAuthClientMetadata,
  OAUTH_TIMEOUT } from
"./constants/oauth";
import { XAI_CONFIG, XAI_PKCE_VERIFIER_BYTES } from "./constants/xai";
import {
  validateXaiOAuthEndpoint,
  decodeXaiIdTokenEmail,
  extractEmailFromAccessToken,
  extractCodexAccountInfo,
  fetchClaudeProfile,
  claudeProfileFields,
  fetchKiroProfileArn } from
"./providerHelpers";
import { isFunction, isObject, isString } from "../../shared/utils/typeChecks.js";
import { assertPublicUrlResolved } from "../../shared/utils/ssrfGuard.js";
import { OAuthCancelledError, throwIfOAuthCancelled } from "./cancellation.js";

export { OAuthCancelledError, throwIfOAuthCancelled };
import orcarouter from "./orcarouterProvider.js";
import gheCopilot from "./gheCopilotProvider.js";
import copilotM365 from "./copilotM365Provider.js";
import museCode from "./museCodeProvider.js";
import openference from "./openferenceProvider.js";
import freebuff from "./freebuffProvider.js";
import workbuddy from "./workbuddyProvider.js";
import zedHosted from "./zedHostedProvider.js";
import { devinDesktopOAuth } from "./services/devin-desktop.js";
import { minimaxCodeOAuthProvider } from "./services/minimax-code.js";

export { extractCodexAccountInfo, fetchKiroProfileArn, fetchClaudeProfile, claudeProfileFields };

// Inlined from services/xai.js to keep web route bundle free of `open` (CLI-only) package
let cachedXaiDiscovery = null;

async function discoverXaiEndpoints(proxyOptions = null) {
  if (cachedXaiDiscovery) return cachedXaiDiscovery;
  try {
    const res = await fetch(XAI_CONFIG.discoveryUrl, {
      headers: { Accept: "application/json" },
      proxyOptions
    });
    if (res.ok) {
      const data = await res.json();
      cachedXaiDiscovery = {
        authorizeUrl: validateXaiOAuthEndpoint(data.authorization_endpoint, "authorization_endpoint"),
        tokenUrl: validateXaiOAuthEndpoint(data.token_endpoint, "token_endpoint")
      };
      return cachedXaiDiscovery;
    }
  } catch {/* fall through to static fallback */}
  cachedXaiDiscovery = { authorizeUrl: XAI_CONFIG.authorizeUrl, tokenUrl: XAI_CONFIG.tokenUrl };
  return cachedXaiDiscovery;
}

/**
 * Build a Qoder device-code provider handler set for a region. `config` is
 * the registry oauth block (open-sse/providers/registry/qoder.js or
 * qoder-cn.js), which carries the region's login/deviceToken/userInfo URLs.
 * The device flow (PKCE + nonce + machine_id, poll until a `dt-...` token
 * appears) is identical across regions — only the hosts differ, and
 * `new QoderService(config)` resolves those per-region URLs.
 */
function createQoderProviderHandlers(config) {
  return {
    config,
    flowType: "device_code",
    // Qoder uses a custom device flow: PKCE + nonce + machine_id are generated
    // locally, the user lands on qoder.com[.cn]/device/selectAccounts in the
    // browser, and we poll the region's deviceToken endpoint until a `dt-...`
    // token appears.
    requestDeviceCode: async (cfg) => {
      const { QoderService } = await import("@/lib/oauth/services/qoder");
      const flow = new QoderService(cfg).initiateDeviceFlow();
      // Match the device_code shape the rest of the OAuthModal expects
      // (device_code, user_code, verification_uri[_complete], interval).
      // The poll endpoint identifies us by nonce+verifier, not by a
      // server-issued device_code, so we plumb our own values through:
      //   device_code   = nonce  (modal forwards as deviceCode on poll)
      //   codeVerifier  = our PKCE verifier (route forwards as codeVerifier)
      return {
        device_code: flow.nonce,
        user_code: flow.nonce.slice(0, 8).toUpperCase(),
        verification_uri: cfg.loginUrl,
        verification_uri_complete: flow.verificationUriComplete,
        expires_in: 300,
        interval: 2,
        codeVerifier: flow.codeVerifier,
        _qoderNonce: flow.nonce,
        _qoderMachineId: flow.machineId
      };
    },
    pollToken: async (cfg, deviceCode, codeVerifier, extraData, proxyOptions) => {
      const { QoderService } = await import("@/lib/oauth/services/qoder");
      const svc = new QoderService(cfg);
      const nonce = deviceCode || extraData?._qoderNonce;
      const verifier = codeVerifier || extraData?._qoderVerifier;
      if (!nonce || !verifier) {
        return {
          ok: false,
          data: { error: "invalid_request", error_description: "Missing nonce/verifier" }
        };
      }
      let result;
      try {
        result = await svc.pollDeviceToken({ nonce, codeVerifier: verifier, proxyOptions });
      } catch (err) {
        return {
          ok: false,
          data: { error: "poll_failed", error_description: err.message }
        };
      }
      if (result.status === "pending") {
        return { ok: false, data: { error: "authorization_pending" } };
      }
      // Best-effort profile lookup so we have a name/email to display.
      const userInfo = await svc.fetchUserInfo(result.accessToken, proxyOptions);
      // expireTime is a Unix-ms timestamp from QoderService.parseExpiry,
      // which already falls back to "now + 30 days" when the upstream
      // omits expiry. Floor to a sane minimum (1 day) so a stale or
      // skewed upstream timestamp doesn't truncate the stored token below
      // something useful.
      const minSeconds = 24 * 60 * 60;
      const remainingSeconds = Math.floor((result.expireTime - Date.now()) / 1000);
      const expiresIn = Math.max(minSeconds, remainingSeconds);
      return {
        ok: true,
        data: {
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
          expires_in: expiresIn,
          _qoderUserId: result.userId,
          _qoderMachineId: extraData?._qoderMachineId || "",
          _qoderName: userInfo.name,
          _qoderEmail: userInfo.email,
          _qoderOrganizationId: userInfo.organizationId
        }
      };
    },
    mapTokens: (tokens) => {
      const rawEmail = (tokens._qoderEmail || "").trim();
      const displayName = (tokens._qoderName || "").trim() || null;
      const userId = tokens._qoderUserId || "";
      // Dedup in createProviderConnection requires a non-empty email. When
      // fetchUserInfo silently fails (returns ""), fall back to a stable
      // synthetic identifier derived from userId so re-logins update the
      // existing row instead of accumulating "Account N" duplicates.
      const email = rawEmail || (userId ? `qoder-user-${userId}` : null);
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresIn: tokens.expires_in,
        email,
        displayName,
        providerSpecificData: {
          authMethod: "device",
          userId,
          machineId: tokens._qoderMachineId || "",
          organizationId: tokens._qoderOrganizationId || ""
        }
      };
    }
  };
}

/**
 * Bounds for the Antigravity `onboardUser` long-running operation.
 *
 * `onboardUser` is a Google long-running operation: it answers `done:false`
 * until the account's Cloud Code project is provisioned, so the caller has to
 * re-send the same request. The bounds are operator-tunable through
 * `ANTIGRAVITY_ONBOARD_MAX_ATTEMPTS` and `ANTIGRAVITY_ONBOARD_RETRY_DELAY_MS`.
 *
 * These are deliberately separate from the `ONBOARD_MAX_ATTEMPTS` /
 * `ONBOARD_RETRY_DELAY_MS` variables used by the runtime project-discovery
 * path (`open-sse/services/projectId.js`): that path runs per request with
 * anti-abuse spacing, while this path runs once per sign-in and blocks the
 * OAuth callback until the project is known. Keeping the names apart means an
 * operator who already tuned the runtime knobs does not silently shorten the
 * sign-in poll.
 *
 * @param {string} name  - environment variable name
 * @param {number} fallback - default used when the variable is unset or invalid
 * @param {number} min - smallest accepted value
 * @returns {number}
 */
function antigravityOnboardBound(name, fallback, min) {
  const raw = process.env[name];
  // An unset or empty variable means "use the default"; only a real number
  // overrides it.
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) return fallback;
  return Math.floor(value);
}

/** Maximum `onboardUser` polls before the sign-in fails closed. */
function antigravityOnboardMaxAttempts() {
  return antigravityOnboardBound("ANTIGRAVITY_ONBOARD_MAX_ATTEMPTS", 10, 1);
}

/** Delay between two `onboardUser` polls, in milliseconds. */
function antigravityOnboardRetryDelayMs() {
  return antigravityOnboardBound("ANTIGRAVITY_ONBOARD_RETRY_DELAY_MS", 5000, 0);
}

/**
 * Sleep that ends early, with the cancelled outcome, when `signal` aborts.
 * The timer and the abort listener are always released.
 */
function abortableDelay(ms, signal) {
  throwIfOAuthCancelled(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new OAuthCancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function antigravityRequestSignal(signal) {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readAntigravityOAuthJson(response, signal) {
  const text = await readBoundedResponseText(response, {
    signal, maxBytes: 1024 * 1024, timeoutMs: 30_000, throwOnTimeout: true
  });
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON in Antigravity OAuth response");
  }
  if (!data || !isObject(data) || Array.isArray(data)) {
    throw new Error("Invalid Antigravity OAuth response");
  }
  return data;
}

/** Resolve user info and the project for a fresh Antigravity token. */
async function antigravityResolveAccount(tokens, proxyOptions, signal) {
  // Google fingerprints X-Goog-Api-Client / Client-Metadata on these calls
  // and then refuses to provision a cloudaicompanionProject, so the real
  // Antigravity IDE sends neither.
  const loadHeaders = {
    "Authorization": `Bearer ${tokens.access_token}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
    "x-request-source": "local"
  };
  const metadata = getOAuthClientMetadata();

  const userInfoSignal = antigravityRequestSignal(signal);
  const userInfoRes = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "x-request-source": "local"
    },
    proxyOptions,
    signal: userInfoSignal
  });
  if (!userInfoRes.ok) throw new Error(`Antigravity user info failed: ${userInfoRes.status}`);
  const userInfo = await readAntigravityOAuthJson(userInfoRes, userInfoSignal);
  if (!isString(userInfo.email) || !userInfo.email.trim()) {
    throw new Error("Antigravity user info did not return an email");
  }

  const loadSignal = antigravityRequestSignal(signal);
  const loadRes = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint, {
    method: "POST",
    headers: loadHeaders,
    body: JSON.stringify({ metadata }),
    proxyOptions,
    signal: loadSignal
  });
  if (!loadRes.ok) throw new Error(`Antigravity project lookup failed: ${loadRes.status}`);
  const data = await readAntigravityOAuthJson(loadRes, loadSignal);
  let projectId = extractAntigravityProject(data);
  const tierId = extractAntigravityOnboardTier(data);

  // A new account can have no project until onboarding completes. Persist
  // only the project associated with this token, never a placeholder.
  if (!projectId) {
    const maxAttempts = antigravityOnboardMaxAttempts();
    const retryDelayMs = antigravityOnboardRetryDelayMs();
    for (let i = 0; i < maxAttempts; i++) {
      throwIfOAuthCancelled(signal);
      const pollSignal = antigravityRequestSignal(signal);
      const onboardRes = await fetch(ANTIGRAVITY_CONFIG.onboardUserEndpoint, {
        method: "POST",
        headers: loadHeaders,
        body: JSON.stringify({ tier_id: tierId, metadata }),
        proxyOptions,
        signal: pollSignal
      });
      throwIfOAuthCancelled(signal);
      if (!onboardRes.ok) throw new Error(`Antigravity onboarding failed: ${onboardRes.status}`);
      const result = await readAntigravityOAuthJson(onboardRes, pollSignal);
      // onboardUser is a long-running operation: Google answers `done:false`
      // until the project is provisioned. Only a settled `done:true` response
      // carries the project, so keep polling instead of reading a missing
      // project as "this account owns no project".
      if (result.done === true) {
        const operationError = antigravityOnboardOperationError(result.error);
        if (operationError) throw operationError;
        projectId = extractAntigravityProject(result.response);
        break;
      }
      if (i < maxAttempts - 1) await abortableDelay(retryDelayMs, signal);
    }
    if (!projectId) throw new Error("Antigravity onboarding did not return a project ID");
  }

  return { userInfo: { email: userInfo.email.trim() }, projectId };
}

function kimiDeviceProvider(config, fallbackVerificationUrl) {
  return {
    config,
    flowType: "device_code",
    requestDeviceCode: async (config, _codeChallenge, _options, proxyOptions) => {
      const deviceId = crypto.randomUUID();
      const response = await fetch(config.deviceCodeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...buildKimiDeviceHeaders(deviceId) },
        body: new URLSearchParams({ client_id: config.clientId }),
        redirect: "error",
        proxyOptions
      });
      if (!response.ok) {
        throw new Error(`Kimi device authorization request failed (HTTP ${response.status})`);
      }
      const data = await response.json();
      if (!isString(data?.device_code) || !data.device_code.trim()) {
        throw new Error("Kimi device authorization response missing device_code");
      }
      if (!data?.user_code) throw new Error("Invalid Kimi device authorization response");
      const verificationUri = data.verification_uri || fallbackVerificationUrl;
      const verificationUriComplete = data.verification_uri_complete ||
        (fallbackVerificationUrl && `${fallbackVerificationUrl}?user_code=${encodeURIComponent(data.user_code)}`);
      if (!verificationUriComplete) {
        throw new Error("Invalid Kimi device authorization response");
      }
      return {
        _deviceId: deviceId,
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: verificationUri,
        verification_uri_complete: verificationUriComplete,
        expires_in: data.expires_in,
        interval: data.interval || 5
      };
    },
    pollToken: async (config, deviceCode, _codeVerifier, extraData, proxyOptions) => {
      const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
      const deviceId = extraData?._deviceId;
      if (deviceId) Object.assign(headers, buildKimiDeviceHeaders(deviceId));
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers,
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: config.clientId,
          device_code: deviceCode
        }),
        redirect: "error",
        proxyOptions
      });
      const data = await response.json().catch(() => null);
      if (!data || !isObject(data) || Array.isArray(data)) {
        return { ok: false, data: { error: "invalid_response", error_description: "Invalid Kimi token response" } };
      }
      if (!response.ok) return { ok: false, data };
      if (data.error) {
        return { ok: false, data: { ...data, error_description: data.error_description || data.message } };
      }

      const { access_token, refresh_token } = data;
      if (!isString(access_token) || !access_token.trim() ||
          (Object.hasOwn(data, "refresh_token") && (!isString(refresh_token) || !refresh_token.trim()))) {
        return { ok: false, data: { error: "invalid_response", error_description: "Invalid Kimi token response" } };
      }
      return { ok: true, data };
    },
    // The pending flow owns this ID. Carry it into the connection only on success.
    postExchange: (_tokens, _proxyOptions, extraData) => extraData,
    mapTokens: (tokens, extraData) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      providerSpecificData: extraData?._deviceId ? { deviceId: extraData._deviceId } : undefined
    })
  };
}

// Codex device flow (headless sign-in).
// Upstream provenance: router-for-me/CLIProxyAPI `sdk/auth/codex_device.go`
// at 6faa8d20b2673404cff70a2f2d9537ae0d0e684d — `codexDeviceTimeout` is 15
// minutes and `codexDeviceDefaultPollIntervalSeconds` is 5.
//
// The OAuth flow store caps every flow at OAUTH_TIMEOUT, and the client polls
// for as long as the advertised window. Advertising the full upstream window
// would have the client poll a session the server already expired, so the
// advertised window is capped with the flow.
const CODEX_DEVICE_FLOW_TTL_SECONDS = Math.min(
  15 * 60,
  Math.floor(OAUTH_TIMEOUT / 1000)
);
const CODEX_DEVICE_POLL_INTERVAL_SECONDS = 5;

/**
 * The Codex device endpoint returns `interval` as either a number of seconds or
 * a numeric string. Anything else falls back to the upstream default.
 */
function parseCodexDevicePollInterval(raw) {
  const seconds = isString(raw) ? Number(raw.trim()) : raw;
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.floor(seconds);
  }
  return CODEX_DEVICE_POLL_INTERVAL_SECONDS;
}

// Provider configurations
const PROVIDERS = {
  claude: {
    config: CLAUDE_CONFIG,
    flowType: "authorization_code_pkce",
    buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
      const params = new URLSearchParams({
        code: "true",
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: config.scopes.join(" "),
        code_challenge: codeChallenge,
        code_challenge_method: config.codeChallengeMethod,
        state: state,
        // Anthropic's IdP reuses the browser session for every authorization
        // request made with this public client id. The reused session counts as
        // a session takeover and invalidates the refresh-token family of the
        // account that signed in first, so a second Claude connection silently
        // breaks the first one. `prompt=login` forces a fresh authentication
        // instead of reusing the stored session, which keeps each Claude
        // account's credentials isolated. OmniRoute
        // `src/lib/oauth/providers/claude.ts` sends the same parameter.
        prompt: "login"
      });
      return `${config.authorizeUrl}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state, meta, proxyOptions) => {
      // Parse code - may contain state after #
      let authCode = code;
      let codeState = "";
      if (authCode.includes("#")) {
        const parts = authCode.split("#");
        authCode = parts[0];
        codeState = parts[1] || "";
      }

      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          code: authCode,
          state: codeState || state,
          grant_type: "authorization_code",
          client_id: config.clientId,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier
        }),
        proxyOptions
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return await response.json();
    },
    postExchange: async (tokens, proxyOptions) => {
      // Best-effort: valid tokens must not be thrown away because the profile
      // call failed. A strict proxy pool still aborts inside fetchClaudeProfile.
      const profile = await fetchClaudeProfile(tokens.access_token, CLAUDE_CONFIG.profileUrl, proxyOptions);
      return { profile };
    },
    mapTokens: (tokens, extra) => {
      const profileFields = claudeProfileFields(extra?.profile);
      const profile = extra?.profile;
      const account = tokens.account || {};
      const organization = tokens.organization || {};
      const populated = (value) => value != null && value !== "";
      const email = populated(profile?.account?.email) ? profile.account.email : account.email_address;
      const accountUuid = populated(profile?.account?.uuid) ? profile.account.uuid : account.uuid;
      const orgUuid = populated(profile?.organization?.uuid) ? profile.organization.uuid : organization.uuid;
      const orgName = populated(profile?.organization?.name) ? profile.organization.name : organization.name;
      const providerSpecificData = { ...profileFields.providerSpecificData };
      if (populated(accountUuid)) providerSpecificData.claudeAccountUuid = accountUuid;
      if (populated(orgUuid)) providerSpecificData.claudeOrgUuid = orgUuid;
      if (populated(orgName)) providerSpecificData.claudeOrgName = orgName;

      const mapped = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
        ...profileFields
      };
      if (populated(email)) mapped.email = email;
      if (Object.keys(providerSpecificData).length) mapped.providerSpecificData = providerSpecificData;
      return mapped;
    }
  },

  codex: {
    config: CODEX_CONFIG,
    flowType: "authorization_code_pkce",
    fixedPort: CODEX_CONFIG.fixedPort,
    callbackPath: CODEX_CONFIG.callbackPath,
    buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
      const params = {
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: config.scope,
        code_challenge: codeChallenge,
        code_challenge_method: config.codeChallengeMethod,
        ...config.extraParams,
        state: state
      };
      const queryString = Object.entries(params).
      map(([key, value]) => `${key}=${encodeURIComponent(value)}`).
      join("&");
      return `${config.authorizeUrl}?${queryString}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state, meta, proxyOptions) => {
      const buildRequest = (nextProxyOptions) => ({
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          code: code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier
        }).toString(),
        proxyOptions: nextProxyOptions
      });

      let response = await fetch(config.tokenUrl, buildRequest(proxyOptions));
      if (!response.ok) {
        const error = await response.text();
        if (
        isCloudflareHtmlBadRequest(response.status, error) &&
        proxyOptions?.disableEnvProxy !== true &&
        proxyOptions?.strictProxy !== true)
        {
          response = await fetch(config.tokenUrl, buildRequest({ disableEnvProxy: true }));
          if (response.ok) return await response.json();
          const directError = await response.text();
          throw new Error(`Token exchange failed: ${directError}`);
        }
        throw new Error(`Token exchange failed: ${error}`);
      }

      return await response.json();
    },
    mapTokens: (tokens) => {
      const info = extractCodexAccountInfo(tokens.id_token);
      const mapped = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresIn: tokens.expires_in,
        lastRefreshAt: new Date().toISOString()
      };
      const email = info.email || extractEmailFromAccessToken(tokens.access_token);
      if (email) mapped.email = email;
      if (info.chatgptAccountId || info.chatgptPlanType) {
        mapped.providerSpecificData = {
          chatgptAccountId: info.chatgptAccountId,
          chatgptPlanType: info.chatgptPlanType
        };
      }
      return mapped;
    },
    // Headless sign-in: the Codex device flow.
    //
    // Upstream provenance: router-for-me/CLIProxyAPI `sdk/auth/codex_device.go`
    // at 6faa8d20b2673404cff70a2f2d9537ae0d0e684d (`loginWithDeviceFlow`). It is
    // NOT the RFC 8628 device-code grant: auth.openai.com issues a user code,
    // then hands back an authorization code together with the server-side PKCE
    // pair, and that code is exchanged like any other authorization code. The
    // flow lives under `deviceFlow` (not `flowType: "device_code"`) because the
    // browser PKCE path stays this provider's primary flow.
    deviceFlow: {
      requestDeviceCode: async (config, _codeChallenge, _options, proxyOptions) => {
        const response = await fetch(config.deviceCodeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({ client_id: config.clientId }),
          proxyOptions
        });

        const text = await response.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }
        if (!response.ok) {
          throw new Error(
            `Codex device code request failed: ${text || response.statusText}`
          );
        }

        const deviceAuthId = isString(data.device_auth_id) ?
          data.device_auth_id.trim() :
          "";
        const userCode = (isString(data.user_code) ? data.user_code : "") ||
          (isString(data.usercode) ? data.usercode : "");
        if (!deviceAuthId || !userCode) {
          throw new Error("Codex device code response is missing required fields");
        }

        const verificationUrl = config.deviceVerificationUrl;
        return {
          // The device handle the flow store keeps server-side.
          device_code: deviceAuthId,
          user_code: userCode,
          verification_uri: verificationUrl,
          verification_uri_complete: verificationUrl ?
            `${verificationUrl}?user_code=${encodeURIComponent(userCode)}` :
            undefined,
          expires_in: CODEX_DEVICE_FLOW_TTL_SECONDS,
          interval: parseCodexDevicePollInterval(data.interval),
          // Private: the poll needs the user code next to the device handle.
          _userCode: userCode
        };
      },
      pollToken: async (config, deviceCode, _codeVerifier, extraData, proxyOptions) => {
        const userCode = isString(extraData?._userCode) ?
          extraData._userCode :
          "";
        const response = await fetch(config.deviceTokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            device_auth_id: deviceCode,
            user_code: userCode
          }),
          proxyOptions
        });

        const text = await response.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }

        // Upstream treats 403 and 404 as "still waiting for the user".
        if (!response.ok) {
          if (response.status === 403 || response.status === 404) {
            return { ok: true, data: { error: "authorization_pending" } };
          }
          return {
            ok: false,
            data: {
              error: data.error || "device_token_failed",
              error_description: data.error_description || text || response.statusText
            }
          };
        }

        const authorizationCode = isString(data.authorization_code) ?
          data.authorization_code.trim() :
          "";
        const codeVerifier = isString(data.code_verifier) ?
          data.code_verifier.trim() :
          "";
        if (!authorizationCode || !codeVerifier) {
          return {
            ok: false,
            data: {
              error: "invalid_device_response",
              error_description: "Codex device token response is missing required fields"
            }
          };
        }

        // Exchange the device authorization code. The redirect URI is the one the
        // device flow was minted for, not the loopback callback.
        const tokenResponse = await fetch(config.tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: config.clientId,
            code: authorizationCode,
            redirect_uri: config.deviceRedirectUri,
            code_verifier: codeVerifier
          }).toString(),
          proxyOptions
        });

        const tokenText = await tokenResponse.text();
        let tokens = {};
        try {
          tokens = tokenText ? JSON.parse(tokenText) : {};
        } catch {
          tokens = {};
        }
        if (!tokenResponse.ok || !tokens.access_token) {
          return {
            ok: false,
            data: {
              error: tokens.error || "code_exchange_failed",
              error_description: tokens.error_description || tokenText || tokenResponse.statusText
            }
          };
        }
        return { ok: true, data: tokens };
      }
    }
  },

  xai: {
    config: XAI_CONFIG,
    flowType: "authorization_code_pkce",
    fixedPort: XAI_CONFIG.loopbackPort,
    callbackPath: XAI_CONFIG.callbackPath,
    pkceVerifierBytes: XAI_PKCE_VERIFIER_BYTES,
    prepareConfig: async (config, meta, proxyOptions) => {
      const endpoints = await discoverXaiEndpoints(proxyOptions);
      return {
        ...config,
        authorizeUrl: endpoints.authorizeUrl,
        tokenUrl: endpoints.tokenUrl
      };
    },
    buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
      // Mirror CLIProxyAPI BuildAuthorizeURL: includes nonce, plan, referrer
      const nonce = crypto.randomBytes(16).toString("hex");
      const params = {
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: config.scope,
        code_challenge: codeChallenge,
        code_challenge_method: config.codeChallengeMethod,
        state,
        nonce,
        plan: "generic",
        referrer: "cli-proxy-api"
      };
      const qs = Object.entries(params).
      map(([k, v]) => `${k}=${encodeURIComponent(v)}`).
      join("&");
      return `${config.authorizeUrl}?${qs}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state, meta, proxyOptions) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier
        }),
        proxyOptions
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`xAI token exchange failed: ${error}`);
      }
      return await response.json();
    },
    mapTokens: (tokens) => {
      const mapped = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope
      };
      const email = decodeXaiIdTokenEmail(tokens.id_token);
      if (email) mapped.email = email;
      if (tokens.id_token) {
        mapped.providerSpecificData = { idToken: tokens.id_token };
      }
      return mapped;
    }
  },

  "grok-cli": {
    config: GROK_CLI_CONFIG,
    flowType: "device_code",
    // Grok CLI / Grok Build — device code flow to auth.x.ai, inference on cli-chat-proxy.grok.com
    requestDeviceCode: async (config, codeChallenge, options, proxyOptions) => {
      const body = new URLSearchParams({
        client_id: config.clientId,
        scope: config.scope
      });
      // Official CLI sends referrer=grok-build
      if (config.referrer) body.set("referrer", config.referrer);

      const response = await fetch(config.deviceCodeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": GROK_CLI_PAGER_USER_AGENT
        },
        body,
        proxyOptions
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Grok CLI device code request failed: ${error}`);
      }

      const data = await response.json();
      // OmniRoute #7358 validates device authorization data before presenting links.
      if (!isString(data?.device_code) || !isString(data?.user_code) ||
          !isString(data?.verification_uri)) {
        throw new Error("Grok device authorization response is incomplete");
      }
      if (!/^[A-Za-z0-9-]+$/.test(data.user_code)) {
        throw new Error("Grok returned an invalid device code");
      }
      for (const value of [data.verification_uri, data.verification_uri_complete]) {
        if (value === undefined) continue;
        if (!isString(value) || /[\x00-\x1f\x7f]/.test(value)) {
          throw new Error("Grok returned an invalid verification URL");
        }
        let url;
        try { url = new URL(value); } catch {
          throw new Error("Grok returned an invalid verification URL");
        }
        if (url.protocol !== "https:" && !(url.protocol === "http:" &&
            (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) {
          throw new Error("Grok returned an unsupported verification URL");
        }
      }
      return data;
    },
    pollToken: async (config, deviceCode, codeVerifier, extraData, proxyOptions) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": GROK_CLI_PAGER_USER_AGENT
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: config.clientId
        }),
        proxyOptions
      });

      let data;
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: "invalid_response", error_description: text };
      }

      // Device flow: 400 + authorization_pending / slow_down is expected while the user authorizes.
      const pending = data?.error === "authorization_pending" || data?.error === "slow_down";
      return { ok: response.ok || pending, data };
    },
    postExchange: async (tokens, proxyOptions) => {
      // Best-effort user profile from cli-chat-proxy (non-fatal).
      try {
        const res = await fetch("https://cli-chat-proxy.grok.com/v1/user", {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: "application/json",
            "User-Agent": GROK_CLI_PAGER_USER_AGENT,
            "x-xai-token-auth": "xai-grok-cli",
            "x-grok-client-version": GROK_CLI_VERSION
          },
          proxyOptions
        });
        if (res.ok) return { user: await res.json() };
      } catch {

        /* ignore */}
      return { user: null };
    },
    mapTokens: (tokens, extra) => {
      const email =
      decodeXaiIdTokenEmail(tokens.id_token) ||
      extractEmailFromAccessToken(tokens.access_token) ||
      extra?.user?.email ||
      null;
      const userId = extra?.user?.userId || extra?.user?.principalId || null;
      const displayName =
      [extra?.user?.firstName, extra?.user?.lastName].filter(Boolean).join(" ").trim() || null;

      // Branch fix/feat/durindoor-fixes-ports: absolute expiresAt enables proactive refresh.
      const expiresAt = tokens.expires_in ?
      new Date(Date.now() + tokens.expires_in * 1000).toISOString() :
      null;
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresIn: tokens.expires_in,
        expiresAt,
        scope: tokens.scope,
        // Top-level for dashboard connection cards.
        email,
        ...(displayName ? { displayName } : null),
        providerSpecificData: {
          authMethod: "device_code",
          ...(tokens.id_token ? { idToken: tokens.id_token } : null),
          ...(email ? { email } : null),
          ...(userId ? { userId } : null)
        }
      };
    }
  },

  "gemini-cli": {
    config: GEMINI_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: config.scopes.join(" "),
        state: state,
        access_type: "offline",
        prompt: "consent"
      });
      return `${config.authorizeUrl}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state, meta, proxyOptions) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code: code,
          redirect_uri: redirectUri
        }),
        proxyOptions
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return await response.json();
    },
    postExchange: async (tokens, proxyOptions) => {
      // Fetch user info
      const userInfoRes = await fetch(`${GEMINI_CONFIG.userInfoUrl}?alt=json`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        proxyOptions
      });
      const userInfo = userInfoRes.ok ? await userInfoRes.json() : {};

      // Fetch project ID
      let projectId = "";
      try {
        const projectRes = await fetch(
          "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              metadata: getOAuthClientMetadata(),
              mode: 1
            }),
            proxyOptions
          }
        );
        if (projectRes.ok) {
          const data = await projectRes.json();
          // Only a nonempty ID is usable; a truthy response object would prevent
          // the request path from attempting its own project discovery.
          const project = data.cloudaicompanionProject;
          const id = isString(project) ? project : project?.id;
          projectId = isString(id) ? id.trim() : "";
        }
      } catch (e) {
        console.log("Failed to fetch project ID:", e);
      }

      return { userInfo, projectId };
    },
    mapTokens: (tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
      email: extra?.userInfo?.email,
      projectId: extra?.projectId
    })
  },

  antigravity: {
    config: ANTIGRAVITY_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: config.scopes.join(" "),
        state: state,
        access_type: "offline",
        prompt: "consent"
      });
      return `${config.authorizeUrl}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, _verifier, _state, _meta, proxyOptions, signal) => {
      const requestSignal = antigravityRequestSignal(signal);
      try {
        const response = await fetch(config.tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: redirectUri
          }),
          proxyOptions,
          signal: requestSignal
        });
        if (!response.ok) throw new Error(`Antigravity token exchange failed: ${response.status}`);
        const tokens = await readAntigravityOAuthJson(response, requestSignal);
        if (!isString(tokens.access_token) || !tokens.access_token.trim()) {
          throw new Error("Antigravity token exchange did not return an access token");
        }
        return { ...tokens, access_token: tokens.access_token.trim() };
      } catch (error) {
        if (signal?.aborted) throw new OAuthCancelledError();
        throw error;
      }
    },
    postExchange: async (tokens, proxyOptions, _extraData, signal) => {
      throwIfOAuthCancelled(signal);
      try {
        return await antigravityResolveAccount(tokens, proxyOptions, signal);
      } catch (error) {
        // An aborted request rejects with a transport error; report the
        // cancellation instead of a provider failure.
        if (signal?.aborted) throw new OAuthCancelledError();
        throw error;
      }
    },
    mapTokens: (tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
      email: extra?.userInfo?.email,
      projectId: extra?.projectId
    })
  },

  iflow: {
    config: IFLOW_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      const params = new URLSearchParams({
        loginMethod: config.extraParams.loginMethod,
        type: config.extraParams.type,
        redirect: redirectUri,
        state: state,
        client_id: config.clientId
      });
      return `${config.authorizeUrl}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state, meta, proxyOptions) => {
      // Create Basic Auth header
      const basicAuth = Buffer.from(
        `${config.clientId}:${config.clientSecret}`
      ).toString("base64");

      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: `Basic ${basicAuth}`
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret
        }),
        proxyOptions
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return await response.json();
    },
    postExchange: async (tokens, proxyOptions) => {
      // Fetch user info (MUST succeed to get API key)
      const userInfoRes = await fetch(
        `${IFLOW_CONFIG.userInfoUrl}?accessToken=${encodeURIComponent(tokens.access_token)}`,
        {
          headers: {
            Accept: "application/json"
          },
          proxyOptions
        }
      );

      if (!userInfoRes.ok) {
        const errorText = await userInfoRes.text();
        throw new Error(`Failed to fetch user info: ${errorText}`);
      }

      const result = await userInfoRes.json();
      if (!result.success) {
        throw new Error(`User info request failed: ${result.message || 'Unknown error'}`);
      }

      const userInfo = result.data || {};

      // Validate API key (critical for iFlow)
      if (!userInfo.apiKey || userInfo.apiKey.trim() === "") {
        throw new Error("Empty API key returned from iFlow");
      }

      // Validate email/phone
      const email = userInfo.email?.trim() || userInfo.phone?.trim();
      if (!email) {
        throw new Error("Missing account email/phone in user info");
      }

      return { userInfo };
    },
    mapTokens: (tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      apiKey: extra?.userInfo?.apiKey,
      email: extra?.userInfo?.email || extra?.userInfo?.phone,
      displayName: extra?.userInfo?.nickname || extra?.userInfo?.name
    })
  },

  qoder: createQoderProviderHandlers(QODER_CONFIG),
  "qoder-cn": createQoderProviderHandlers(QODER_CN_CONFIG),

  qwen: {
    config: QWEN_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config, codeChallenge, options = {}, proxyOptions) => {
      const response = await fetch(config.deviceCodeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          scope: config.scope,
          code_challenge: codeChallenge,
          code_challenge_method: config.codeChallengeMethod
        }),
        proxyOptions
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Device code request failed: ${error}`);
      }

      return await response.json();
    },
    pollToken: async (config, deviceCode, codeVerifier, extraData, proxyOptions) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: config.clientId,
          device_code: deviceCode,
          code_verifier: codeVerifier
        }),
        proxyOptions
      });

      return {
        ok: response.ok,
        data: await response.json()
      };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      providerSpecificData: { resourceUrl: tokens.resource_url }
    })
  },

  github: {
    config: GITHUB_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config, codeChallenge, options = {}, proxyOptions) => {
      const response = await fetch(config.deviceCodeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          scope: config.scopes
        }),
        proxyOptions
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Device code request failed: ${error}`);
      }

      return await response.json();
    },
    pollToken: async (config, deviceCode, codeVerifier, extraData, proxyOptions) => {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        }),
        proxyOptions
      });

      // Read once so a non-JSON response can still be returned as an error.
      // Adapted from OmniRoute src/lib/oauth/providers/github.ts.
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: "invalid_response", error_description: text };
      }

      return {
        ok: response.ok,
        data: data
      };
    },
    postExchange: async (tokens, proxyOptions) => {
      // Get Copilot token using GitHub access token
      const copilotRes = await fetch(GITHUB_CONFIG.copilotTokenUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
          "User-Agent": GITHUB_CONFIG.userAgent
        },
        proxyOptions
      });
      const copilotToken = copilotRes.ok ? await copilotRes.json() : {};

      // Get user info from GitHub
      const userRes = await fetch(GITHUB_CONFIG.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
          "User-Agent": GITHUB_CONFIG.userAgent
        },
        proxyOptions
      });
      const userInfo = userRes.ok ? await userRes.json() : {};

      return { copilotToken, userInfo };
    },
    mapTokens: (tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      name: extra?.userInfo?.login || extra?.userInfo?.name,
      displayName: extra?.userInfo?.name || extra?.userInfo?.login,
      email: extra?.userInfo?.email || null,
      providerSpecificData: {
        copilotToken: extra?.copilotToken?.token,
        copilotTokenExpiresAt: extra?.copilotToken?.expires_at,
        githubUserId: extra?.userInfo?.id,
        githubLogin: extra?.userInfo?.login,
        githubName: extra?.userInfo?.name,
        githubEmail: extra?.userInfo?.email
      }
    })
  },

  kiro: {
    config: KIRO_CONFIG,
    flowType: "device_code",
    // Kiro uses AWS SSO OIDC - requires client registration first
    requestDeviceCode: async (config, codeChallenge, options = {}, proxyOptions) => {
      const trimmedRegion = isString(options.region) ? options.region.trim() : "";
      const region = trimmedRegion || "us-east-1";
      assertValidAwsRegion(region);
      const trimmedStartUrl = isString(options.startUrl) ? options.startUrl.trim() : "";
      const startUrl = trimmedStartUrl || config.startUrl;
      const authMethod = options.authMethod === "idc" ? "idc" : "builder-id";
      const registerClientUrl = `https://oidc.${region}.amazonaws.com/client/register`;
      const deviceAuthUrl = `https://oidc.${region}.amazonaws.com/device_authorization`;
      const registration = {
        clientName: config.clientName,
        clientType: config.clientType,
        scopes: config.scopes,
        grantTypes: config.grantTypes
      };
      // OmniRoute src/lib/oauth/providers/kiro.ts: enterprise start URLs
      // must not be bound to the fixed Builder ID issuer.
      if (authMethod !== "idc") registration.issuerUrl = config.issuerUrl;

      const registerRes = await fetch(registerClientUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(registration),
        proxyOptions
      });

      if (!registerRes.ok) {
        const error = await registerRes.text();
        throw new Error(`Client registration failed: ${error}`);
      }

      const clientInfo = await registerRes.json();

      const deviceRes = await fetch(deviceAuthUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          clientId: clientInfo.clientId,
          clientSecret: clientInfo.clientSecret,
          startUrl
        }),
        proxyOptions
      });

      if (!deviceRes.ok) {
        const error = await deviceRes.text();
        throw new Error(`Device authorization failed: ${error}`);
      }

      const deviceData = await deviceRes.json();

      // Return combined data for polling
      return {
        device_code: deviceData.deviceCode,
        user_code: deviceData.userCode,
        verification_uri: deviceData.verificationUri,
        verification_uri_complete: deviceData.verificationUriComplete,
        expires_in: deviceData.expiresIn,
        interval: deviceData.interval || 5,
        // Store client credentials for token exchange
        _clientId: clientInfo.clientId,
        _clientSecret: clientInfo.clientSecret,
        _region: region,
        _authMethod: authMethod,
        _startUrl: startUrl
      };
    },
    pollToken: async (config, deviceCode, codeVerifier, extraData, proxyOptions) => {
      const region = extraData?._region || "us-east-1";
      assertValidAwsRegion(region);
      const tokenUrl = `https://oidc.${region}.amazonaws.com/token`;
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          clientId: extraData?._clientId,
          clientSecret: extraData?._clientSecret,
          deviceCode: deviceCode,
          grantType: "urn:ietf:params:oauth:grant-type:device_code"
        }),
        proxyOptions
      });

      let data;
      if (isFunction(response.text)) {
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = { error: "invalid_response", error_description: text };
        }
      } else {
        try {
          data = await response.json();
        } catch (e) {
          data = { error: "invalid_response" };
        }
      }

      // AWS SSO OIDC returns camelCase
      if (data.accessToken) {
        return {
          ok: true,
          data: {
            access_token: data.accessToken,
            refresh_token: data.refreshToken,
            expires_in: data.expiresIn,
            profile_arn: data?.profileArn || null,
            // Store client credentials for refresh
            _clientId: extraData?._clientId,
            _clientSecret: extraData?._clientSecret,
            _region: extraData?._region,
            _authMethod: extraData?._authMethod,
            _startUrl: extraData?._startUrl
          }
        };
      }

      return {
        ok: false,
        data: {
          error: data.error || "authorization_pending",
          error_description: data.error_description || data.message
        }
      };
    },
    mapTokens: (tokens) => {
      const email = extractEmailFromAccessToken(tokens.access_token);
      const mapped = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        email,
        providerSpecificData: {
          profileArn: tokens?.profile_arn || null,
          clientId: tokens._clientId,
          clientSecret: tokens._clientSecret,
          region: tokens._region || "us-east-1",
          authMethod: tokens._authMethod || "builder-id",
          startUrl: tokens._startUrl || KIRO_CONFIG.startUrl
        }
      };
      return mapped;
    }
  },

  cursor: {
    config: CURSOR_CONFIG,
    flowType: "import_token",
    // Cursor uses import token flow - tokens are extracted from local SQLite database
    // No OAuth flow needed, handled by /api/oauth/cursor/import route
    mapTokens: (tokens) => ({
      accessToken: tokens.accessToken,
      refreshToken: null, // Cursor doesn't have public refresh endpoint
      expiresIn: tokens.expiresIn || 86400,
      providerSpecificData: {
        machineId: tokens.machineId,
        authMethod: "imported"
      }
    })
  },

  "kimi-coding": kimiDeviceProvider(KIMI_CODING_CONFIG, "https://www.kimi.com/code/authorize_device"),
  "kimi-ai": kimiDeviceProvider(KIMI_AI_CONFIG),

  kilocode: {
    config: KILOCODE_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config, codeChallenge, options = {}, proxyOptions) => {
      const response = await fetch(config.initiateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        proxyOptions
      });
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Too many pending authorization requests. Please try again later.");
        }
        const error = await response.text();
        throw new Error(`Device auth initiation failed: ${error}`);
      }
      const data = await response.json();
      return {
        device_code: data.code,
        user_code: data.code,
        verification_uri: data.verificationUrl,
        verification_uri_complete: data.verificationUrl,
        expires_in: data.expiresIn || 300,
        interval: 3
      };
    },
    pollToken: async (config, deviceCode, codeVerifier, extraData, proxyOptions) => {
      const response = await fetch(`${config.pollUrlBase}/${deviceCode}`, { proxyOptions });
      if (response.status === 202) return { ok: false, data: { error: "authorization_pending" } };
      if (response.status === 403) return { ok: false, data: { error: "access_denied", error_description: "Authorization denied by user" } };
      if (response.status === 410) return { ok: false, data: { error: "expired_token", error_description: "Authorization code expired" } };
      if (!response.ok) return { ok: false, data: { error: "poll_failed", error_description: `Poll failed: ${response.status}` } };
      const data = await response.json();
      if (data.status === "approved" && data.token) {
        // Fetch profile to get orgId for X-Kilocode-OrganizationID header
        let orgId = null;
        try {
          const profileRes = await fetch(`${config.apiBaseUrl}/api/profile`, {
            headers: { "Authorization": `Bearer ${data.token}` },
            proxyOptions
          });
          if (profileRes.ok) {
            const profile = await profileRes.json();
            orgId = profile.organizations?.[0]?.id || null;
          }
        } catch {}
        return { ok: true, data: { access_token: data.token, _userEmail: data.userEmail, _orgId: orgId } };
      }
      return { ok: false, data: { error: "authorization_pending" } };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: null,
      expiresIn: null,
      email: tokens._userEmail,
      ...(tokens._orgId ? { providerSpecificData: { orgId: tokens._orgId } } : null)
    })
  },

  cline: {
    config: CLINE_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      const params = new URLSearchParams({
        client_type: "extension",
        callback_url: redirectUri,
        redirect_uri: redirectUri,
        state
      });
      return `${config.authorizeUrl}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state, meta, proxyOptions) => {
      try {
        // Cline encodes token data as base64 in the code param
        let base64 = code;
        try { base64 = decodeURIComponent(base64); } catch { /* Keep an already-decoded or malformed code. */ }
        const padding = 4 - base64.length % 4;
        if (padding !== 4) base64 += "=".repeat(padding);
        const decoded = Buffer.from(base64, "base64").toString("utf-8");
        const lastBrace = decoded.lastIndexOf("}");
        if (lastBrace === -1) throw new Error("No JSON found in decoded code");
        const tokenData = JSON.parse(decoded.substring(0, lastBrace + 1));
        return {
          access_token: tokenData.accessToken,
          refresh_token: tokenData.refreshToken,
          email: tokenData.email,
          firstName: tokenData.firstName,
          lastName: tokenData.lastName,
          expires_at: tokenData.expiresAt
        };
      } catch (e) {
        const response = await fetch(config.tokenExchangeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ grant_type: "authorization_code", code, client_type: "extension", redirect_uri: redirectUri }),
          proxyOptions
        });
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Cline token exchange failed: ${error}`);
        }
        const data = await response.json();
        return {
          access_token: data.data?.accessToken || data.accessToken,
          refresh_token: data.data?.refreshToken || data.refreshToken,
          email: data.data?.userInfo?.email || "",
          expires_at: data.data?.expiresAt || data.expiresAt
        };
      }
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_at ?
      Math.floor((new Date(tokens.expires_at).getTime() - Date.now()) / 1000) :
      3600,
      email: tokens.email,
      providerSpecificData: { firstName: tokens.firstName, lastName: tokens.lastName }
    })
  },
  clinepass: {
    config: CLINEPASS_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      const params = new URLSearchParams({
        client_type: "extension",
        callback_url: redirectUri,
        redirect_uri: redirectUri,
        state
      });
      return `${config.authorizeUrl}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state, meta, proxyOptions) => {
      try {
        // Cline encodes token data as base64 in the code param
        let base64 = code;
        try { base64 = decodeURIComponent(base64); } catch { /* Keep an already-decoded or malformed code. */ }
        const padding = 4 - base64.length % 4;
        if (padding !== 4) base64 += "=".repeat(padding);
        const decoded = Buffer.from(base64, "base64").toString("utf-8");
        const lastBrace = decoded.lastIndexOf("}");
        if (lastBrace === -1) throw new Error("No JSON found in decoded code");
        const tokenData = JSON.parse(decoded.substring(0, lastBrace + 1));
        return {
          access_token: tokenData.accessToken,
          refresh_token: tokenData.refreshToken,
          email: tokenData.email,
          firstName: tokenData.firstName,
          lastName: tokenData.lastName,
          expires_at: tokenData.expiresAt
        };
      } catch (e) {
        const response = await fetch(config.tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ grant_type: "authorization_code", code, client_type: "extension", redirect_uri: redirectUri }),
          proxyOptions
        });
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`ClinePass token exchange failed: ${error}`);
        }
        const data = await response.json();
        return {
          access_token: data.data?.accessToken || data.accessToken,
          refresh_token: data.data?.refreshToken || data.refreshToken,
          email: data.data?.userInfo?.email || "",
          expires_at: data.data?.expiresAt || data.expiresAt
        };
      }
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_at ?
      Math.floor((new Date(tokens.expires_at).getTime() - Date.now()) / 1000) :
      3600,
      email: tokens.email,
      providerSpecificData: { firstName: tokens.firstName, lastName: tokens.lastName }
    })
  },
  // GitLab Duo - Authorization Code Flow with PKCE
  // Supports two login modes via loginMode metadata: "oauth" (default) or "pat"
  gitlab: {
    config: GITLAB_CONFIG,
    flowType: "authorization_code_pkce",
    buildAuthUrl: (config, redirectUri, state, codeChallenge, meta = {}) => {
      const baseUrl = meta.baseUrl || config.defaultBaseUrl;
      const clientId = meta.clientId || "";
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        state,
        scope: config.scope,
        code_challenge: codeChallenge,
        code_challenge_method: config.codeChallengeMethod
      });
      return `${baseUrl}${config.authorizeUrlPath}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state, meta = {}, proxyOptions) => {
      const baseUrl = meta.baseUrl || config.defaultBaseUrl;
      await assertPublicUrlResolved(`${baseUrl}${config.tokenUrlPath}`);
      const clientId = meta.clientId || "";
      const clientSecret = meta.clientSecret || "";
      const body = new URLSearchParams({
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      });
      if (clientSecret) body.set("client_secret", clientSecret);
      const response = await fetch(`${baseUrl}${config.tokenUrlPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body.toString(),
        redirect: "manual",
        proxyOptions
      });
      if (!response.ok) throw new Error("GitLab token exchange failed");
      const tokens = await response.json();
      // Fetch user info
      await assertPublicUrlResolved(`${baseUrl}${config.userInfoUrlPath}`);
      const userRes = await fetch(`${baseUrl}${config.userInfoUrlPath}`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        redirect: "manual",
        proxyOptions
      });
      const user = userRes.ok ? await userRes.json() : {};
      return { ...tokens, _user: user, _baseUrl: baseUrl, _clientId: clientId };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
      providerSpecificData: {
        username: tokens._user?.username || "",
        email: tokens._user?.email || tokens._user?.public_email || "",
        name: tokens._user?.name || "",
        baseUrl: tokens._baseUrl,
        clientId: tokens._clientId,
        authKind: "oauth"
      }
    })
  },

  "gitlab-duo": {
    config: GITLAB_DUO_CONFIG,
    flowType: "authorization_code_pkce",
    buildAuthUrl: (config, redirectUri, state, codeChallenge, meta = {}) => {
      const baseUrl = (meta.baseUrl || config.defaultBaseUrl || "https://gitlab.com").replace(/\/$/, "");
      const clientId = meta.clientId || config.clientId || "";
      if (!clientId) return null;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        state,
        scope: config.scope,
        code_challenge: codeChallenge,
        code_challenge_method: config.codeChallengeMethod
      });
      return `${baseUrl}${config.authorizeUrlPath}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state, meta = {}, proxyOptions) => {
      const baseUrl = (meta.baseUrl || config.defaultBaseUrl || "https://gitlab.com").replace(/\/$/, "");
      await assertPublicUrlResolved(`${baseUrl}${config.tokenUrlPath}`);
      const clientId = meta.clientId || config.clientId || "";
      // Deployment credentials belong only to the configured GitLab instance.
      const configuredBase = (config.defaultBaseUrl || "https://gitlab.com").replace(/\/$/, "");
      const clientSecret = meta.clientSecret || (baseUrl === configuredBase ? config.clientSecret : "") || "";
      const body = new URLSearchParams({
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      });
      if (clientSecret) body.set("client_secret", clientSecret);
      const response = await fetch(`${baseUrl}${config.tokenUrlPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body.toString(),
        redirect: "manual",
        proxyOptions
      });
      if (!response.ok) throw new Error("GitLab Duo token exchange failed");
      const tokens = await response.json();
      await assertPublicUrlResolved(`${baseUrl}${config.userInfoUrlPath}`);
      const userRes = await fetch(`${baseUrl}${config.userInfoUrlPath}`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        redirect: "manual",
        proxyOptions
      });
      const user = userRes.ok ? await userRes.json() : {};
      return { ...tokens, _user: user, _baseUrl: baseUrl, _clientId: clientId };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
      providerSpecificData: {
        username: tokens._user?.username || "",
        email: tokens._user?.email || tokens._user?.public_email || "",
        name: tokens._user?.name || "",
        baseUrl: tokens._baseUrl || GITLAB_DUO_CONFIG.defaultBaseUrl,
        clientId: tokens._clientId || GITLAB_DUO_CONFIG.clientId,
        authKind: "oauth"
      }
    })
  },

  // Trae SOLO uses a user-approved session import. The token cannot be refreshed.
  trae: {
    config: TRAE_CONFIG,
    flowType: "import_token",
    buildAuthUrl: () => null,
    mapTokens: (tokens, extra) => {
      // `isObject` accepts null and arrays in this tree, so shape the two
      // sources explicitly: only a plain object carries named fields.
      const credential = tokens && isObject(tokens) && !Array.isArray(tokens) ? tokens : {};
      const request = extra && isObject(extra) && !Array.isArray(extra) ? extra : {};
      const pick = (...names) => {
        for (const name of names) {
          const value = credential[name] ?? request[name];
          if (value === undefined || value === null || value === "") continue;
          // The import route has no per-provider schema, so the value arrives
          // as whatever the client sent. Keep the stored shape a string.
          return isString(value) ? value.trim() : String(value);
        }
        return "";
      };
      const region = pick("region") || "US-East";
      const userTimezone = pick("userTimezone", "user_timezone");
      return {
        accessToken:
        credential.accessToken ||
        credential.access_token ||
        credential.token ||
        request.accessToken ||
        request.access_token ||
        request.token ||
        (isString(tokens) ? tokens : ""),
        refreshToken: null,
        expiresIn:
        Number(credential.expiresIn) ||
        Number(request.expiresIn) ||
        TRAE_CONFIG.tokenLifetimeDays * 24 * 60 * 60,
        providerSpecificData: {
          webId: pick("webId", "web_id"),
          bizUserId: pick("bizUserId", "biz_user_id"),
          userUniqueId: pick("userUniqueId", "user_unique_id"),
          scope: pick("scope") || "marscode-us",
          tenant: pick("tenant") || "marscode",
          region,
          aiRegion: pick("aiRegion", "ai_region") || region,
          appLanguage: pick("appLanguage", "app_language") || "en",
          appVersion: pick("appVersion", "app_version") || "1.0.0.1229",
          // "US" stays the best-effort default so imports that omit the region
          // keep behaving as before; a real account region (e.g. "SG") has to
          // be supplied — it is not a universal replacement default
          // (cheaper-inference/OmniRoute #12190, PR #13255).
          userRegion: pick("userRegion", "user_region") || "US",
          ...(userTimezone ? { userTimezone } : null),
          userIdentity: pick("userIdentity", "user_identity") || "Free",
          authMethod: "imported"
        }
      };
    }
  },

  "devin-cli": {
    config: DEVIN_CLI_CONFIG,
    flowType: "import_token",
    buildAuthUrl: () => null,
    mapTokens: (tokens) => ({
      accessToken: tokens.accessToken || tokens.access_token || tokens.token || tokens,
      refreshToken: null,
      expiresIn: tokens.expiresIn || null,
      providerSpecificData: { authKind: "import_token" }
    })
  },

  windsurf: {
    config: WINDSURF_CONFIG,
    flowType: "import_token",
    buildAuthUrl: () => null,
    mapTokens: (tokens) => ({
      accessToken: tokens.accessToken || tokens.access_token || tokens.token || tokens,
      refreshToken: null,
      expiresIn: tokens.expiresIn || null,
      providerSpecificData: { authKind: "import_token" }
    })
  },

  // CodeBuddy (Tencent) - Browser OAuth Polling Flow
  // 1. POST stateUrl → get { state, authUrl }
  // 2. Open authUrl in browser
  // 3. Poll tokenUrl with state until success (code 0) or timeout
  "codebuddy-cn": {
    config: CODEBUDDY_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config, codeChallenge, options = {}, proxyOptions) => {
      const response = await fetch(`${config.stateUrl}?platform=${config.platform}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": config.userAgent,
          "X-Requested-With": "XMLHttpRequest",
          "X-Domain": "copilot.tencent.com",
          "X-No-Authorization": "true",
          "X-No-User-Id": "true",
          "X-Product": "SaaS"
        },
        body: JSON.stringify({ platform: config.platform }),
        proxyOptions
      });
      if (!response.ok) throw new Error(`CodeBuddy state request failed: ${await response.text()}`);
      const data = await response.json();
      const authUrl = data.data?.authUrl || data.data?.url;
      if (data.code !== 0 || !data.data?.state || !authUrl) {
        throw new Error(`CodeBuddy state error: ${data.msg || "missing state/authUrl"}`);
      }
      return {
        device_code: data.data.state,
        verification_uri: authUrl,
        user_code: "",
        interval: config.pollInterval / 1000,
        _isCodeBuddy: true
      };
    },
    pollToken: async (config, deviceCode, codeVerifier, extraData, proxyOptions) => {
      // CodeBuddy polls the token endpoint via GET with the state as a query
      // param (not POST/body) — matches the official CLI's /v2/plugin/auth/token?state=...
      const response = await fetch(`${config.tokenUrl}?state=${encodeURIComponent(deviceCode)}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": config.userAgent,
          "X-Requested-With": "XMLHttpRequest",
          "X-Domain": "copilot.tencent.com",
          "X-No-Authorization": "true",
          "X-No-User-Id": "true",
          "X-No-Enterprise-Id": "true",
          "X-No-Department-Info": "true",
          "X-Product": "SaaS"
        },
        proxyOptions
      });
      if (!response.ok) return { ok: false, data: { error: "request_failed" } };
      const data = await response.json();
      // code 11217 = pending (RetryFetchToken), code 0 = success
      if (data.code === 0 && data.data?.accessToken) {
        return {
          ok: true,
          data: {
            access_token: data.data.accessToken,
            refresh_token: data.data.refreshToken || "",
            token_type: data.data.tokenType || "Bearer",
            expires_in: data.data.expiresIn
          }
        };
      }
      if (data.code === 11217) return { ok: true, data: { error: "authorization_pending" } };
      return { ok: false, data: { error: data.msg || "unknown_error" } };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 86400,
      providerSpecificData: {}
    })
  },

  kimchi: {
    config: KIMCHI_CONFIG,
    flowType: "browser_token",
    buildAuthUrl: (config, redirectUri, state) => {
      const baseUrl = (config.webAppUrl || "https://app.kimchi.dev").replace(/\/+$/, "");
      const params = new URLSearchParams({
        callback: redirectUri,
        state
      });
      return `${baseUrl}/cli-auth?${params.toString()}`;
    },
    exchangeToken: async (config, token, redirectUri, codeVerifier, state, meta, proxyOptions) => {
      const accessToken = String(token || "").trim();
      if (!accessToken) {
        throw new Error("Missing Kimchi token");
      }

      const validationUrl = config.validationUrl || "https://api.cast.ai/v1/llm/openai/supported-providers";
      const validationRes = await fetch(validationUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        proxyOptions
      });
      if (!validationRes.ok) {
        throw new Error(`Kimchi token validation failed: ${validationRes.status}`);
      }

      let userInfo = {};
      if (config.userInfoUrl) {
        try {
          const userRes = await fetch(config.userInfoUrl, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`
            },
            proxyOptions
          });
          if (userRes.ok) {
            userInfo = await userRes.json();
          }
        } catch {
          userInfo = {};
        }
      }

      return {
        access_token: accessToken,
        token_type: "Bearer",
        _kimchiUser: userInfo
      };
    },
    mapTokens: (tokens) => {
      const user = tokens._kimchiUser || {};
      const userId = user.id ? String(user.id) : "";
      const username = user.username || "";
      const email = user.email || (userId ? `kimchi-user-${userId}` : null);
      return {
        accessToken: tokens.access_token,
        refreshToken: null,
        email,
        displayName: user.name || username || null,
        providerSpecificData: {
          authMethod: "browser_token",
          userId,
          username
        }
      };
    }
  },
  orcarouter,
  "ghe-copilot": gheCopilot,
  // Microsoft 365 Copilot native sign-in (work or school accounts). A pasted session still saves
  // as a cookie row; this adds a refreshable oauth row beside it.
  "copilot-m365-web": copilotM365,
  "muse-code": museCode,
  openference,
  // Opt-in session providers (dispatch stays off per connection until
  // providerSpecificData.enableSessionDispatch is true).
  "devin-desktop": devinDesktopOAuth,
  "minimax-code": minimaxCodeOAuthProvider,
  "zed-hosted": zedHosted,
  freebuff,
  workbuddy
};

// Amazon Q Developer signs in exactly like Kiro (AWS Builder ID / IAM Identity
// Center device flow); only the stored provider id differs.
PROVIDERS["amazon-q"] = PROVIDERS.kiro;

function isCloudflareHtmlBadRequest(status, body) {
  return status === 400 && /<html/i.test(body || "") && /cloudflare/i.test(body || "");
}

/**
 * Get provider handler
 */
export function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

/**
 * Get all provider names
 */
export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

/**
 * Generate auth data for a provider
 * @param {object} [meta] - Provider-specific metadata (e.g. gitlab clientId/baseUrl)
 */
export async function generateAuthData(providerName, redirectUri, meta, proxyOptions = null) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig ?
  await provider.prepareConfig(provider.config, meta || {}, proxyOptions) :
  provider.config;
  const generated = generatePKCE(provider.pkceVerifierBytes);
  const { codeChallenge, state } = generated;
  let { codeVerifier } = generated;
  let effectiveRedirectUri = redirectUri;
  let authMeta = null;

  // A token-import provider that also offers a browser PKCE sign-in (Devin
  // Desktop) declares supportsBrowserPkce; every other import provider
  // (devin-cli) has no authorize URL and keeps the import-token path.
  const usesPkce = provider.flowType === "authorization_code_pkce" || provider.supportsBrowserPkce === true;
  let authUrl;
  if (provider.flowType === "device_code") {
    // Device code flow doesn't have auth URL upfront
    authUrl = null;
  } else if (usesPkce) {
    // The Devin CLI client only accepts its fixed loopback callback.
    if (provider.supportsBrowserPkce && provider.fixedPort && provider.callbackHost) {
      effectiveRedirectUri = `http://${provider.callbackHost}:${provider.fixedPort}${provider.callbackPath || "/callback"}`;
    }
    authUrl = provider.buildAuthUrl(config, effectiveRedirectUri, state, codeChallenge, meta || {});
  } else {
    authUrl = provider.buildAuthUrl(config, effectiveRedirectUri, state, undefined, meta || {});
  }

  // A provider may return a record instead of a bare URL when its flow carries
  // more than PKCE: Zed Hosted binds an RSA private key where the verifier
  // would go, reports the loopback redirect it expects, and needs its system id
  // at exchange time.
  if (authUrl && isObject(authUrl) && !Array.isArray(authUrl)) {
    const { authUrl: url, codeVerifier: verifier, redirectUri: reported, ...rest } = authUrl;
    authUrl = url || null;
    if (verifier) codeVerifier = verifier;
    if (reported) effectiveRedirectUri = reported;
    if (Object.keys(rest).length) authMeta = rest;
  }

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri: effectiveRedirectUri,
    ...(authMeta ? { meta: authMeta } : null),
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath || "/callback"
  };
}

/**
 * Exchange code for tokens
 * @param {object} [meta] - Provider-specific metadata (e.g. gitlab clientId/baseUrl)
 * @param {AbortSignal} [signal] - Caller cancellation; a fired signal rejects with `OAuthCancelledError`
 */
export async function exchangeTokens(providerName, code, redirectUri, codeVerifier, state, meta, proxyOptions = null, signal = null) {
  throwIfOAuthCancelled(signal);
  const provider = getProvider(providerName);
  const config = provider.prepareConfig ?
  await provider.prepareConfig(provider.config, meta || {}, proxyOptions) :
  provider.config;

  const exchangeArgs = [config, code, redirectUri, codeVerifier, state, meta || {}, proxyOptions];
  const tokens = providerName === "antigravity" ?
    await provider.exchangeToken(...exchangeArgs, signal) :
    await provider.exchangeToken(...exchangeArgs);

  let extra = null;
  if (provider.postExchange) {
    // `signal` rides as a trailing argument; providers that do not use it ignore it.
    extra = await provider.postExchange(tokens, proxyOptions, undefined, signal || undefined);
  }

  return provider.mapTokens(tokens, extra);
}

/**
 * Resolve the device-flow handler set for a provider.
 *
 * A provider is device-only (`flowType: "device_code"`, handlers on the
 * provider record) or dual: its primary flow is something else (Codex keeps
 * browser PKCE) and the device handlers live under `deviceFlow`.
 */
function resolveDeviceFlow(provider) {
  if (!provider) return null;
  if (provider.flowType === "device_code") return provider;
  return provider.deviceFlow || null;
}

/**
 * Request device code (for device_code flow)
 */
export async function requestDeviceCode(providerName, codeChallenge, options, proxyOptions = null) {
  const provider = getProvider(providerName);
  const device = resolveDeviceFlow(provider);
  if (!device || !isFunction(device.requestDeviceCode)) {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  return await device.requestDeviceCode(provider.config, codeChallenge, options || {}, proxyOptions);
}

/**
 * Poll for token (for device_code flow)
 * @param {string} providerName - Provider name
 * @param {string} deviceCode - Device code from requestDeviceCode
 * @param {string} codeVerifier - PKCE code verifier (optional for some providers)
 * @param {object} extraData - Extra data from device code response (e.g. clientId/clientSecret for Kiro)
 * @param {AbortSignal} [signal] - Optional cancellation, forwarded to `postExchange` as its last argument
 */
export async function pollForToken(providerName, deviceCode, codeVerifier, extraData, proxyOptions = null, signal = null) {
  const provider = getProvider(providerName);
  const device = resolveDeviceFlow(provider);
  if (!device || !isFunction(device.pollToken)) {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }

  const result = await device.pollToken(provider.config, deviceCode, codeVerifier, extraData, proxyOptions);

  if (result.ok) {
    // For device code flows, success is only when we have an access token
    if (result.data.access_token) {
      // Call postExchange to get additional data (copilotToken, userInfo, etc.)
      let extra = null;
      if (provider.postExchange) {
        extra = await provider.postExchange(result.data, proxyOptions, extraData, signal || undefined);
      }
      const tokens = provider.mapTokens(result.data, extra);
      // Kiro IDC/Builder-ID tokens lack profileArn; resolve it to avoid 403.
      // Use the same region the token was issued in so IDC accounts in
      // eu-west-1 / ap-southeast-1 hit their regional CodeWhisperer endpoint.
      if ((providerName === "kiro" || providerName === "amazon-q") && !tokens.providerSpecificData?.profileArn) {
        const region = tokens.providerSpecificData?.region || "us-east-1";
        const profileArn = await fetchKiroProfileArn(tokens.accessToken, region, proxyOptions);
        if (!profileArn) {
          throw new Error("Kiro profile discovery returned no usable profile");
        }
        tokens.providerSpecificData.profileArn = profileArn;
      }
      return { success: true, tokens };
    } else {
      // Check if it's still pending authorization
      if (result.data.error === 'authorization_pending' || result.data.error === 'slow_down') {
        // This is not a failure, just still waiting
        return {
          success: false,
          error: result.data.error,
          errorDescription: result.data.error_description || result.data.message,
          pending: result.data.error === 'authorization_pending'
        };
      } else {
        // Actual error
        return {
          success: false,
          error: result.data.error || 'no_access_token',
          errorDescription: result.data.error_description || result.data.message || 'No access token received'
        };
      }
    }
  }

  return { success: false, error: result.data.error, errorDescription: result.data.error_description };
}

// Run-once guard across the process lifetime
let codexBackfillDone = false;

// Backfill email + chatgpt account info for existing codex OAuth connections missing them
export async function backfillCodexEmails() {
  if (codexBackfillDone) return;
  codexBackfillDone = true;
  try {
    const { getProviderConnections, updateProviderConnection } = await import("@/lib/localDb");
    const connections = await getProviderConnections();
    const targets = connections.filter((c) => {
      if (c.provider !== "codex" || c.authType !== "oauth" || !c.idToken) return false;
      const hasEmail = !!c.email;
      const hasAccountInfo = !!c.providerSpecificData?.chatgptAccountId;
      return !hasEmail || !hasAccountInfo;
    });
    for (const conn of targets) {
      const info = extractCodexAccountInfo(conn.idToken);
      if (!info.email && !info.chatgptAccountId) continue;
      const patch = {};
      if (!conn.email && info.email) patch.email = info.email;
      if (info.chatgptAccountId || info.chatgptPlanType) {
        patch.providerSpecificData = {
          ...(conn.providerSpecificData || {}),
          chatgptAccountId: info.chatgptAccountId,
          chatgptPlanType: info.chatgptPlanType
        };
      }
      if (Object.keys(patch).length) {
        await updateProviderConnection(conn.id, patch);
      }
    }
  } catch (err) {
    codexBackfillDone = false;
    console.log("backfillCodexEmails failed:", err?.message || err);
  }
}

// Run-once guard across the process lifetime
let claudeBackfillDone = false;

/**
 * Backfill email + organization plan info for claude OAuth connections that
 * predate the profile fetch.
 *
 * Unlike `backfillCodexEmails` (a local idToken decode) this makes one network
 * call per affected connection, so callers MUST NOT await it — the guard resets
 * on failure and the next call retries.
 */
export async function backfillClaudeProfiles() {
  if (claudeBackfillDone) return;
  claudeBackfillDone = true;
  try {
    const { getProviderConnections, updateProviderConnection } = await import("@/lib/localDb");
    const connections = await getProviderConnections();
    const targets = connections.filter((c) => (
      c.provider === "claude" &&
      c.authType === "oauth" &&
      !!c.accessToken &&
      (!c.email || !c.providerSpecificData?.claudeAccountUuid)));

    for (const conn of targets) {
      const profile = await fetchClaudeProfile(conn.accessToken, CLAUDE_CONFIG.profileUrl);
      const fields = claudeProfileFields(profile);
      const patch = {};
      if (!conn.email && fields.email) patch.email = fields.email;
      if (fields.providerSpecificData) {
        patch.providerSpecificData = {
          ...(conn.providerSpecificData || {}),
          ...fields.providerSpecificData
        };
      }
      if (Object.keys(patch).length) {
        await updateProviderConnection(conn.id, patch);
      }
    }
  } catch (err) {
    claudeBackfillDone = false;
    console.log("backfillClaudeProfiles failed:", err?.message || err);
  }
}
