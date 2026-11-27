import { OAuthService } from "./oauth.js";
import { GITHUB_CONFIG } from "../constants/oauth.js";
import { spinner as createSpinner } from "../utils/ui.js";

/**
 * GitHub Copilot OAuth Service
 * Uses Device Code Flow for authentication
 */
export class GitHubService extends OAuthService {
  constructor() {
    super(GITHUB_CONFIG);
  }

  /**
   * Get device code for GitHub authentication
   */
  async getDeviceCode() {
    const response = await fetch(`${GITHUB_CONFIG.deviceCodeUrl}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      redirect: "manual",
      body: new URLSearchParams({
        client_id: GITHUB_CONFIG.clientId,
        scope: GITHUB_CONFIG.scopes,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get device code (HTTP ${response.status})`);
    }

    const data = await response.json();
    if (!data?.device_code || !data.user_code || data.verification_uri !== "https://github.com/login/device" ||
        !Number.isInteger(data.expires_in) || data.expires_in <= 0 || data.expires_in > 3600 ||
        (data.interval !== undefined && (!Number.isInteger(data.interval) || data.interval < 0 || data.interval > 3600))) {
      throw new Error("Invalid GitHub device response");
    }
    return data;
  }

  /**
   * Poll for access token using device code
   */
  async pollAccessToken(deviceCode, verificationUri, userCode, interval = 5000, expiresIn = 900, signal) {
    const deadline = Date.now() + expiresIn * 1000;
    const spinner = createSpinner("Waiting for GitHub authentication...").start();
    
    // Show user code and verification URL
    console.log(`\nPlease visit: ${verificationUri}`);
    console.log(`Enter code: ${userCode}\n`);
    
    // Open browser automatically
    try {
      const open = (await import("open")).default;
      await open(verificationUri);
    } catch (error) {
      console.log("Could not open browser automatically. Please visit the URL above manually.");
    }

    // Poll for access token
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || interval >= remaining) throw new Error("Device code expired");
      await new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error("Device authentication cancelled"));
        const onAbort = () => { clearTimeout(timer); reject(new Error("Device authentication cancelled")); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, interval);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      if (Date.now() >= deadline) throw new Error("Device code expired");

      const response = await fetch(`${GITHUB_CONFIG.tokenUrl}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        redirect: "manual",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]) : AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        body: new URLSearchParams({
          client_id: GITHUB_CONFIG.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const data = await response.json();

      if (data.access_token) {
        spinner.succeed("GitHub authentication successful!");
        return {
          access_token: data.access_token,
          token_type: data.token_type,
          scope: data.scope,
        };
      } else if (data.error === "authorization_pending") {
        // Continue polling
        continue;
      } else if (data.error === "slow_down") {
        // Increase polling interval
        interval += 5000;
        continue;
      } else if (data.error === "expired_token") {
        spinner.fail("Device code expired. Please try again.");
        throw new Error("Device code expired");
      } else if (data.error === "access_denied") {
        spinner.fail("Access denied by user.");
        throw new Error("Access denied");
      } else {
        spinner.fail("Failed to get access token.");
        throw new Error("GitHub token request failed");
      }
    }
  }

  /**
   * Get Copilot token using GitHub access token
   */
  async getCopilotToken(accessToken) {
    const response = await fetch(`${GITHUB_CONFIG.copilotTokenUrl}`, {
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${accessToken}`, // GitHub API typically uses Bearer
        Accept: "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get Copilot token (HTTP ${response.status})`);
    }

    return await response.json();
  }

  /**
   * Get user info using GitHub access token
   */
  async getUserInfo(accessToken) {
    const response = await fetch(`${GITHUB_CONFIG.userInfoUrl}`, {
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${accessToken}`, // GitHub API typically uses Bearer
        Accept: "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info (HTTP ${response.status})`);
    }

    return await response.json();
  }

  /**
   * Complete GitHub Copilot authentication flow
   */
  async authenticate() {
    try {
      // Get device code
      const deviceResponse = await this.getDeviceCode();
      
      // Poll for access token
      const tokenResponse = await this.pollAccessToken(
        deviceResponse.device_code, 
        deviceResponse.verification_uri, 
        deviceResponse.user_code,
        Math.max(1, deviceResponse.interval || 5) * 1000,
        deviceResponse.expires_in || 900
      );
      
      // Get Copilot token
      const copilotToken = await this.getCopilotToken(tokenResponse.access_token);
      
      // Get user info
      const userInfo = await this.getUserInfo(tokenResponse.access_token);
      
      console.log(`\n✅ Successfully authenticated as ${userInfo.login}`);
      
      return {
        accessToken: tokenResponse.access_token,
        copilotToken: copilotToken.token,
        refreshToken: null, // GitHub device flow doesn't return refresh token
        expiresIn: copilotToken.expires_at,
        userInfo: {
          id: userInfo.id,
          login: userInfo.login,
          name: userInfo.name,
          email: userInfo.email,
        },
        copilotTokenInfo: copilotToken,
      };
    } catch (error) {
      throw new Error(`GitHub authentication failed: ${error.message}`);
    }
  }

  /**
   * Connect to server with GitHub credentials
   */
  async connect() {
    try {
      // Authenticate with GitHub
      const authResult = await this.authenticate();
      
      // Send credentials to server
      const { server, token, userId } = await import("../config/index.js").then(m => m.getServerCredentials());
      const spinner = (await import("../utils/ui.js")).spinner("Connecting to server...").start();
      
      const response = await fetch(`${server}/api/cli/providers/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-User-Id": userId,
        },
        body: JSON.stringify({
          accessToken: authResult.accessToken,
          copilotToken: authResult.copilotToken,
          userInfo: authResult.userInfo,
          copilotTokenInfo: authResult.copilotTokenInfo,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to connect to server (HTTP ${response.status})`);
      }
      
      spinner.succeed("GitHub Copilot connected successfully!");
      console.log(`\nConnected as: ${authResult.userInfo.login}`);
    } catch (error) {
      const { error: showError } = await import("../utils/ui.js");
      showError(`GitHub connection failed: ${error.message}`);
      throw error;
    }
  }
}
