import { QWEN_CONFIG } from "../constants/oauth.js";

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Authorization cancelled"));
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new Error("Authorization cancelled")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Qwen OAuth Service
 * Uses Device Code Flow with PKCE
 */
export class QwenService {
  constructor() {
    this.config = QWEN_CONFIG;
  }

  /**
   * Request device code
   */
  async requestDeviceCode(codeChallenge) {
    const response = await fetch(this.config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        scope: this.config.scope,
        code_challenge: codeChallenge,
        code_challenge_method: this.config.codeChallengeMethod,
      }),
    }).catch(() => { throw new Error("Qwen device authorization failed"); });

    if (!response.ok) {
      throw new Error("Qwen device authorization failed");
    }

    return response.json().catch(() => { throw new Error("Qwen device authorization failed"); });
  }

  /** Poll until the device code expires, with cancellable waits and requests. */
  async pollForToken(deviceCode, codeVerifier, interval = 5, { expiresIn = 300, signal } = {}) {
    const deadline = Date.now() + Math.max(0, expiresIn) * 1000;
    let pollInterval = Math.max(1, interval) * 1000;
    const deadlineController = new AbortController();
    const timer = setTimeout(() => deadlineController.abort(), Math.max(0, deadline - Date.now()));
    const requestSignal = signal ? AbortSignal.any([signal, deadlineController.signal]) : deadlineController.signal;

    try {
      while (Date.now() + pollInterval < deadline) {
        await delay(pollInterval, requestSignal);
        const response = await fetch(this.config.tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            client_id: this.config.clientId,
            device_code: deviceCode,
            code_verifier: codeVerifier,
          }),
          signal: requestSignal,
        }).catch(() => { throw new Error("Qwen token request failed"); });
        if (requestSignal.aborted) throw new Error("Authorization cancelled");
        if (response.ok) {
          const tokens = await response.json().catch(() => { throw new Error("Qwen token request failed"); });
          if (requestSignal.aborted) throw new Error("Authorization cancelled");
          if (!tokens.access_token) throw new Error("Qwen token response missing access token");
          return tokens;
        }
        let error;
        try { error = (await response.json()).error; } catch { /* Ignore upstream body. */ }
        if (error === "authorization_pending") continue;
        if (error === "slow_down") { pollInterval += 5000; continue; }
        if (error === "expired_token") throw new Error("Device code expired");
        if (error === "access_denied") throw new Error("Access denied");
        throw new Error("Qwen token request failed");
      }
      await delay(Math.max(0, deadline - Date.now()), requestSignal);
      throw new Error("Authorization timeout");
    } catch (error) {
      if (signal?.aborted) throw new Error("Authorization cancelled");
      if (deadlineController.signal.aborted) throw new Error("Authorization timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** This legacy service has no server-side token import route in DurinDoor. */
  async saveTokens() {
    throw new Error("Qwen CLI token import is unavailable");
  }

  /** Use the shared OAuth flow to create a connection. */
  async connect() {
    throw new Error("Qwen CLI token import is unavailable; use the shared OAuth flow");
  }
}
