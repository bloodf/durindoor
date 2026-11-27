import open from "open";
import { generatePKCE } from "../utils/pkce.js";
import { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } from "../constants/oauth.js";
import { startLocalServer, waitForCallbackParams } from "../utils/server.js";
import { spinner as createSpinner } from "../utils/ui.js";
import {
  antigravityAgeRestrictionError,
  antigravityOnboardOperationError,
  extractAntigravityOnboardTier,
  extractAntigravityProject
} from "../../../../open-sse/services/antigravityProvisioning.js";

import { isString } from "../../../shared/utils/typeChecks.js";

/**
 * Antigravity OAuth Service
 * Uses standard OAuth2 Authorization Code flow (similar to Gemini)
 *
 * Sign-in order and validation follow CLIProxyAPI (MIT)
 * sdk/auth/antigravity.go and internal/auth/antigravity/auth.go at
 * dbe641f286a489ecb39e3c041c554371e6add864: an empty access token or email
 * fails the sign-in, onboarding runs only when loadCodeAssist returns no
 * project, and a settled onboarding operation error or a missing project fails
 * closed.
 */
export class AntigravityService {
  constructor() {
    this.config = ANTIGRAVITY_CONFIG;
  }

  /** Fail locally on a blank or incomplete client override; never fall back. */
  assertConfigured() {
    if (this.config.oauthConfigError || !this.config.clientId) {
      throw new Error(this.config.oauthConfigError || "Antigravity OAuth client is not configured");
    }
  }

  /**
   * Build Antigravity authorization URL
   */
  buildAuthUrl(redirectUri, state, codeChallenge) {
    this.assertConfigured();
    if (!isString(codeChallenge) || !codeChallenge) {
      throw new Error("Antigravity authorization requires a PKCE challenge");
    }
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      // The desktop client has one registered callback; both legs send it.
      redirect_uri: this.config.fixedRedirectUri || redirectUri,
      scope: this.config.scopes.join(" "),
      state: state,
      access_type: "offline",
      prompt: "consent",
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    });

    return `${this.config.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code, redirectUri, codeVerifier) {
    this.assertConfigured();
    if (!isString(codeVerifier) || !codeVerifier) {
      throw new Error("Antigravity token exchange requires a PKCE verifier");
    }
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: code,
        redirect_uri: this.config.fixedRedirectUri || redirectUri,
        code_verifier: codeVerifier
      })
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const tokens = await response.json();
    if (!isString(tokens?.access_token) || !tokens.access_token.trim()) {
      throw new Error("Antigravity token exchange did not return an access token");
    }
    return { ...tokens, access_token: tokens.access_token.trim() };
  }

  /**
   * Get user info from Google
   */
  async getUserInfo(accessToken) {
    const response = await fetch(`${this.config.userInfoUrl}?alt=json`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.status}`);
    }

    const userInfo = await response.json();
    if (!isString(userInfo?.email) || !userInfo.email.trim()) {
      throw new Error("Antigravity user info did not return an email");
    }
    return { ...userInfo, email: userInfo.email.trim() };
  }

  /**
   * Get common headers for Antigravity API calls
   */
  getApiHeaders(accessToken) {
    return {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": this.config.loadCodeAssistUserAgent
      // No X-Goog-Api-Client / Client-Metadata: Google fingerprints them and
      // refuses to provision a cloudaicompanionProject.
    };
  }

  /**
   * Get metadata object for loadCodeAssist / onboardUser API calls.
   * Uses numeric enum values matching Antigravity binary ClientMetadata.
   */
  getMetadata() {
    return getOAuthClientMetadata();
  }

  /**
   * Fetch Project ID and Tier with the native client mode (upstream #141).
   */
  async loadCodeAssist(accessToken) {
    const response = await fetch(this.config.loadCodeAssistEndpoint, {
      method: "POST",
      headers: this.getApiHeaders(accessToken),
      body: JSON.stringify({ metadata: this.getMetadata(), mode: 1 })
    });

    if (!response.ok) {
      throw new Error(`Failed to load code assist: ${response.status}`);
    }

    const data = await response.json();
    // Same project keys and tier fallback (default tier, then current tier,
    // then free-tier) as the dashboard sign-in.
    const projectId = extractAntigravityProject(data);
    const tierId = extractAntigravityOnboardTier(data);
    if (!projectId) {
      const ageError = antigravityAgeRestrictionError(data);
      if (ageError) throw ageError;
    }
    return { projectId, tierId };
  }

  /**
   * Onboard user to enable Gemini Code Assist for the project
   */
  async onboardUser(accessToken, projectId, tierId) {
    const response = await fetch(this.config.onboardUserEndpoint, {
      method: "POST",
      headers: this.getApiHeaders(accessToken),
      body: JSON.stringify({ tierId, metadata: this.getMetadata(), mode: 1 })
    });

    if (!response.ok) {
      throw new Error(`Failed to onboard user: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Complete onboarding flow with retry
   */
  async completeOnboarding(accessToken, projectId, tierId, maxRetries = 10) {
    for (let i = 0; i < maxRetries; i++) {
      const result = await this.onboardUser(accessToken, projectId, tierId);

      if (result?.done === true) {
        const operationError = antigravityOnboardOperationError(result.error);
        if (operationError) throw operationError;
        const finalProjectId = extractAntigravityProject(result.response) || projectId;
        if (!finalProjectId) throw new Error("Antigravity onboarding did not return a project ID");
        return { success: true, projectId: finalProjectId };
      }

      // Wait 5 seconds before the next poll; never after the last one.
      if (i < maxRetries - 1) await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error("Onboarding timeout - please try again");
  }

  /**
   * Fetch Project ID from loadCodeAssist API (legacy method for compatibility)
   */
  async fetchProjectId(accessToken) {
    const { projectId } = await this.loadCodeAssist(accessToken);
    if (!projectId) {
      throw new Error("No cloudaicompanionProject found in response");
    }
    return projectId;
  }

  /**
   * Save Antigravity tokens to server
   */
  async saveTokens(tokens, userInfo, projectId) {
    const { getServerCredentials } = await import("../config/index.js");
    const { server, token, userId } = getServerCredentials();

    const response = await fetch(`${server}/api/cli/providers/antigravity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-User-Id": userId
      },
      body: JSON.stringify({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
        email: userInfo.email,
        projectId: projectId // Send projectId to server
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to save tokens");
    }

    return await response.json();
  }

  /**
   * Complete Antigravity OAuth flow
   */
  async connect() {
    const spinner = createSpinner("Starting Antigravity OAuth...").start();
    let closeServer = null;

    try {
      spinner.text = "Starting local server...";

      // Start local server for callback
      let callbackParams = null;
      this.assertConfigured();
      // The built-in desktop client is registered for one loopback callback
      // (CLIProxyAPI internal/auth/antigravity/auth.go @47f18e4d); a custom
      // client keeps the random-port /callback listener.
      const fixed = this.config.fixedRedirectUri ? new URL(this.config.fixedRedirectUri) : null;
      const { port, close } = await startLocalServer((params) => {
        callbackParams = params;
      }, fixed ? Number(fixed.port) : null);
      closeServer = close;

      const redirectUri = fixed ? this.config.fixedRedirectUri : `http://localhost:${port}/callback`;
      spinner.succeed(`Local server started on port ${port}`);

      const { codeVerifier, codeChallenge, state } = generatePKCE();

      // Build authorization URL
      const authUrl = this.buildAuthUrl(redirectUri, state, codeChallenge);

      console.log("\nOpening browser for Antigravity authentication...");
      console.log(`If browser doesn't open, visit:\n${authUrl}\n`);

      // A failed launch keeps the printed URL usable.
      try {
        await open(authUrl);
      } catch {
        console.log("Could not open a browser; visit the URL above.");
      }

      // Wait for callback
      spinner.start("Waiting for Antigravity authorization...");

      await waitForCallbackParams(() => callbackParams);

      close();

      if (callbackParams.error) {
        throw new Error(callbackParams.error_description || callbackParams.error);
      }

      if (callbackParams.state !== state) {
        throw new Error("Antigravity callback state does not match this sign-in");
      }
      if (!callbackParams.code) {
        throw new Error("No authorization code received");
      }

      spinner.start("Exchanging code for tokens...");

      // Exchange code for tokens
      const tokens = await this.exchangeCode(callbackParams.code, redirectUri, codeVerifier);

      spinner.text = "Fetching user info...";

      // Get user info
      const userInfo = await this.getUserInfo(tokens.access_token);

      spinner.text = "Loading Code Assist configuration...";

      // Load Code Assist to get project ID and tier
      const { projectId, tierId } = await this.loadCodeAssist(tokens.access_token);

      // An account without a project is onboarded; an existing project is used as is.
      let finalProjectId = projectId;
      if (!finalProjectId) {
        spinner.text = "Onboarding to Gemini Code Assist...";
        const onboardResult = await this.completeOnboarding(tokens.access_token, projectId, tierId);
        finalProjectId = onboardResult.projectId;
      }

      spinner.text = "Saving tokens to server...";

      // Save tokens to server
      await this.saveTokens(tokens, userInfo, finalProjectId);

      spinner.succeed(`Antigravity connected successfully! (${userInfo.email}, Project: ${finalProjectId})`);
      return true;
    } catch (error) {
      spinner.fail(`Failed: ${error.message}`);
      throw error;
    } finally {
      // Release the callback listener after timeout, validation, exchange, or save failures.
      closeServer?.();
    }
  }
}
