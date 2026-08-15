import crypto from "crypto";

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";

const OPENCODE_UA = "opencode";
const MESSAGES_MODELS = new Set();

function generateRequestId() {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
}

function generateSessionId() {
  return `ses_${crypto.randomUUID().replace(/-/g, "")}`;
}

function trustedSessionKey(credentials, requestContext, fallback) {
  const connectionId = typeof credentials?.connectionId === "string" && credentials.connectionId.trim()
    ? credentials.connectionId.trim()
    : null;
  if (!connectionId) return fallback;
  const sessionId = typeof requestContext?.sessionId === "string" && requestContext.sessionId.trim()
    ? requestContext.sessionId.trim()
    : null;
  return JSON.stringify([connectionId, sessionId]);
}

function opaqueSessionId(source) {
  const digest = crypto.createHash("sha256")
    .update("opencode-session\0")
    .update(source)
    .digest("hex");
  return `ses_${digest.slice(0, 32)}`;
}

function isEnabled(name) {
  return /^(1|true|yes|on)$/i.test(process.env[name]?.trim() ?? "");
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
    this._privateSessionKey = crypto.randomUUID();
    this._currentSessionId = null;
  }

  transformRequest(model, body, stream, credentials, requestContext) {
    this._currentSessionId = opaqueSessionId(
      trustedSessionKey(credentials, requestContext, this._privateSessionKey),
    );
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    return MESSAGES_MODELS.has(model)
      ? `${base}/zen/v1/messages`
      : `${base}/zen/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true, requestContext = null) {
    const clientHeaders = new Headers(requestContext?.clientHeaders ?? credentials?.rawHeaders ?? {});
    const clientUa = clientHeaders.get("user-agent");
    const credentialToken = credentials?.apiKey || credentials?.accessToken || credentials?.authorization;
    const hasPaidIdentity = Boolean(credentialToken);
    const baseHeaders = {
      "Content-Type": "application/json",
      "Authorization": credentialToken
        ? (credentialToken.startsWith?.("Bearer ") ? credentialToken : `Bearer ${credentialToken}`)
        : "Bearer public",
      "x-opencode-client": clientHeaders.get("x-opencode-client") || "desktop",
      "Accept": stream ? "text/event-stream" : "*/*",
    };

    if (hasPaidIdentity || isEnabled("OPENCODE_DISABLE_FREE_TIER_HEADERS")) {
      if (clientUa) baseHeaders["User-Agent"] = clientUa;
      if (!hasPaidIdentity) baseHeaders["x-opencode-client"] = "desktop";
      return baseHeaders;
    }

    const clientUaIsCli = /^opencode-cli\//i.test(clientUa?.trim() ?? "");
    const synthesizeCli = isEnabled("OPENCODE_SYNTHESIZE_CLI_HEADERS");
    const headers = {
      ...baseHeaders,
      "x-opencode-client": "desktop",
      "x-opencode-session": this._currentSessionId ?? generateSessionId(),
      "x-opencode-request": generateRequestId(),
      "x-opencode-project": "global",
    };
    if (synthesizeCli && !clientUaIsCli) headers["User-Agent"] = "opencode-cli/1.0.0";
    else if (clientUaIsCli) headers["User-Agent"] = clientUa;
    else headers["User-Agent"] = OPENCODE_UA;
    return headers;
  }
}
