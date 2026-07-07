import crypto from "crypto";
import { DefaultExecutor } from "./default.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const TOKEN_SKEW_MS = 60_000;

export class GigaChatExecutor extends DefaultExecutor {
  constructor() {
    super("gigachat");
    this.tokenCache = new Map();
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return credentials?.runtimeTransport?.baseUrl || this.config.baseUrl;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    if (credentials?.accessToken) {
      headers.Authorization = `Bearer ${credentials.accessToken}`;
    }
    if (stream) headers.Accept = "text/event-stream";
    return headers;
  }

  async exchangeApiKeyForAccessToken(apiKey, proxyOptions = null) {
    const cached = this.tokenCache.get(apiKey);
    if (cached && cached.expiresAt > Date.now() + TOKEN_SKEW_MS) {
      return cached.accessToken;
    }

    const response = await proxyAwareFetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${apiKey}`,
        RqUID: crypto.randomUUID(),
      },
      body: new URLSearchParams({ scope: this.config.tokenScope || "GIGACHAT_API_PERS" }),
    }, proxyOptions);

    if (!response.ok) {
      throw new Error(`GigaChat token exchange failed with HTTP ${response.status}`);
    }

    const token = await response.json();
    if (!token?.access_token) {
      throw new Error("GigaChat token exchange response did not include access_token");
    }

    const expiresAt = Number(token.expires_at) || (Date.now() + Number(token.expires_in || 0) * 1000);
    this.tokenCache.set(apiKey, { accessToken: token.access_token, expiresAt });
    return token.access_token;
  }

  async execute(args) {
    const credentials = args.credentials || {};
    if (credentials.accessToken || !credentials.apiKey) {
      return super.execute(args);
    }

    const accessToken = await this.exchangeApiKeyForAccessToken(credentials.apiKey, args.proxyOptions);
    return super.execute({
      ...args,
      credentials: {
        ...credentials,
        accessToken,
      },
    });
  }
}
