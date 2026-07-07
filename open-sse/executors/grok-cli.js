import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { XAI_CLIENT_ID } from "../../src/lib/oauth/constants/xai.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const GROK_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const GROK_CLI_HEADERS = {
  "x-grok-client-version": "0.2.72",
  "x-grok-client-identifier": "grok_cli_rs",
  "User-Agent": "grok-cli/0.2.72 (Windows 10.0.26200; x64)",
};
const UNSUPPORTED_PARAMS = ["presencePenalty", "frequencyPenalty", "logprobs", "topLogprobs"];

export class GrokCliExecutor extends BaseExecutor {
  constructor() {
    super("grok-cli", PROVIDERS["grok-cli"]);
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      Accept: stream ? "text/event-stream" : "application/json",
      ...GROK_CLI_HEADERS,
    };

    if (credentials.accessToken) {
      headers.Authorization = `Bearer ${credentials.accessToken}`;
    } else if (credentials.apiKey) {
      headers.Authorization = `Bearer ${credentials.apiKey}`;
    }

    return headers;
  }

  transformRequest(model, body, stream) {
    const transformed = body && typeof body === "object" ? { ...body } : {};
    if (!transformed.model) transformed.model = model || "grok-composer-2.5-fast";
    transformed.stream = !!stream;

    for (const key of UNSUPPORTED_PARAMS) {
      delete transformed[key];
    }

    return transformed;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials?.refreshToken) {
      log?.warn?.("TOKEN_REFRESH", "Grok Build: no refresh token available");
      return null;
    }

    try {
      const response = await proxyAwareFetch(GROK_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: XAI_CLIENT_ID,
          refresh_token: credentials.refreshToken,
        }),
      }, proxyOptions);

      if (!response.ok) {
        log?.warn?.("TOKEN_REFRESH", `Grok Build: refresh failed with status ${response.status}`);
        return null;
      }

      const tokens = await response.json();
      if (!tokens.access_token) return null;

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in || 21600,
      };
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", `Grok Build: refresh error: ${error.message}`);
      return null;
    }
  }
}
