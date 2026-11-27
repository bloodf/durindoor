import { ANTIGRAVITY_DESKTOP_PROFILE, ANTIGRAVITY_DESKTOP_REDIRECT_URI, assertAntigravityOAuthConfig } from "../../../../open-sse/providers/shared.js";
import open from "open";
import { generatePKCE } from "../utils/pkce.js";
import { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } from "../constants/oauth.js";
import { startLocalServer, waitForCallbackParams } from "../utils/server.js";
import { spinner as createSpinner } from "../utils/ui.js";

/**
 * Antigravity OAuth Service
 * Uses standard OAuth2 Authorization Code flow (similar to Gemini)
 */
import { isObject, isString } from "../../../shared/utils/typeChecks.js";
export class AntigravityService {
  constructor() {
    this.config = ANTIGRAVITY_CONFIG;
  }

  /**
   * Build Antigravity authorization URL
   */
  buildAuthUrl(redirectUri, state, codeChallenge) {
    assertAntigravityOAuthConfig();
    if (!isString(codeChallenge) || !codeChallenge) {
      throw new Error("Antigravity authorization requires a PKCE challenge");
    }
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
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
    assertAntigravityOAuthConfig();
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
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      })
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    return await response.json();
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

    return await response.json();
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

    // Extract project ID
    let projectId = data.cloudaicompanionProject;
    if (isObject(projectId) && projectId !== null && projectId.id) {
      projectId = projectId.id;
    }

    // Extract tier ID (default to legacy-tier)
    let tierId = "legacy-tier";
    if (Array.isArray(data.allowedTiers)) {
      for (const tier of data.allowedTiers) {
        if (tier.isDefault && tier.id) {
          tierId = tier.id.trim();
          break;
        }
      }
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

      if (result.done === true) {
        // Extract final project ID from response
        let finalProjectId = projectId;
        if (result.response?.cloudaicompanionProject) {
          const respProject = result.response.cloudaicompanionProject;
          if (isString(respProject)) {
            finalProjectId = respProject.trim();
          } else if (respProject.id) {
            finalProjectId = respProject.id.trim();
          }
        }
        return { success: true, projectId: finalProjectId };
      }

      // Wait 5 seconds before retry
      await new Promise((resolve) => setTimeout(resolve, 5000));
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
      const { port, close } = await startLocalServer((params) => {
        callbackParams = params;
      }, ANTIGRAVITY_DESKTOP_PROFILE ? 51121 : null);
      closeServer = close;

      const redirectUri = ANTIGRAVITY_DESKTOP_PROFILE ? ANTIGRAVITY_DESKTOP_REDIRECT_URI : `http://localhost:${port}/callback`;
      spinner.succeed(`Local server started on port ${port}`);

      const { codeVerifier, codeChallenge, state } = generatePKCE();

      // Build authorization URL
      const authUrl = this.buildAuthUrl(redirectUri, state, codeChallenge);

      console.log("\nOpening browser for Antigravity authentication...");
      console.log(`If browser doesn't open, visit:\n${authUrl}\n`);

      // Open browser
      await open(authUrl);

      // Wait for callback
      spinner.start("Waiting for Antigravity authorization...");

      await waitForCallbackParams(() => callbackParams);

      close();

      if (callbackParams.error) {
        throw new Error(callbackParams.error_description || callbackParams.error);
      }

      if (!callbackParams.code || callbackParams.state !== state) {
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

      if (!projectId) {
        throw new Error("No Google Cloud Project found. Please ensure you have a GCP project with Gemini Code Assist enabled.");
      }

      spinner.text = "Onboarding to Gemini Code Assist...";

      // Complete onboarding to enable Gemini Code Assist
      const onboardResult = await this.completeOnboarding(tokens.access_token, projectId, tierId);
      const finalProjectId = onboardResult.projectId || projectId;

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
