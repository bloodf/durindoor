// Device authorization contract from OmniRoute release/v3.8.55,
// src/lib/oauth/providers/workbuddy.ts.
const config = Object.freeze({
  stateUrl: "https://www.workbuddy.ai/v2/plugin/auth/state",
  tokenUrl: "https://www.workbuddy.ai/v2/plugin/auth/token",
  refreshUrl: "https://www.workbuddy.ai/v2/plugin/auth/token/refresh",
  platform: "CLI",
  pollInterval: 5000,
});

export default {
  config,
  flowType: "device_code",
  async requestDeviceCode(cfg = config) {
    const response = await fetch(`${cfg.stateUrl}?platform=${encodeURIComponent(cfg.platform)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Product": "SaaS" },
      body: JSON.stringify({ platform: cfg.platform }),
    });
    if (!response.ok) throw new Error(`WorkBuddy state request failed (${response.status})`);
    const payload = await response.json();
    if (payload.code !== 0 || !payload.data?.state) throw new Error("WorkBuddy state request returned no state");
    const state = String(payload.data.state);
    const url = String(payload.data.authUrl || payload.data.url || "");
    return { device_code: state, user_code: state, verification_uri: url,
      verification_uri_complete: url, expires_in: 600, interval: Math.max(1, Math.floor(cfg.pollInterval / 1000)) };
  },
  async pollToken(cfg, state) {
    const response = await fetch(`${cfg.tokenUrl}?state=${encodeURIComponent(state)}`, {
      headers: { Accept: "application/json", "X-Product": "SaaS" },
    });
    if (!response.ok) return { ok: false, data: { error: "request_failed" } };
    const payload = await response.json();
    if (payload.code === 11217) return { ok: false, data: { error: "authorization_pending" } };
    if (payload.code !== 0 || !payload.data?.accessToken) {
      return { ok: false, data: { error: "poll_failed", error_description: "WorkBuddy token request failed" } };
    }
    return { ok: true, data: { access_token: String(payload.data.accessToken),
      refresh_token: payload.data.refreshToken ? String(payload.data.refreshToken) : "",
      token_type: payload.data.tokenType ? String(payload.data.tokenType) : "Bearer",
      expires_in: payload.data.expiresIn } };
  },
  mapTokens(tokens) {
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 31_104_000, providerSpecificData: {} };
  },
};
