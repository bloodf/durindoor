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

// PR #3321: OpenCode Zen's free-tier IP rate limiter buckets anonymous
// clients by x-real-ip; without it every free-tier user shares one bucket
// and hits FreeUsageLimitError/429. Forward the real client IP so each user
// gets their own bucket. Never forward loopback/private IPs (would put every
// local DurinDoor user into one shared bucket) — custom-server.js stamps
// x-9r-real-ip from the unspoofable TCP peer, which is 127.0.0.1 for local
// clients.
function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.")) return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith("fc00:") || ip.startsWith("fe80:")) return true;
  return false;
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
    delete body.client_metadata;
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
    const isNoAuthFallback = credentials?.id === "noauth" || credentials?.connectionId === "noauth";
    const hasPaidIdentity = !isNoAuthFallback && Boolean(credentialToken);
    const baseHeaders = {
      "Content-Type": "application/json",
      "x-opencode-client": clientHeaders.get("x-opencode-client") || "desktop",
      "Accept": stream ? "text/event-stream" : "*/*",
    };
    if (hasPaidIdentity) {
      baseHeaders.Authorization = credentialToken.startsWith?.("Bearer ") ? credentialToken : `Bearer ${credentialToken}`;
    }

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
    const rawIp = (clientHeaders.get("x-9r-real-ip") || clientHeaders.get("x-real-ip") || "").trim();
    if (rawIp && !isPrivateIp(rawIp)) headers["x-real-ip"] = rawIp;
    if (synthesizeCli && !clientUaIsCli) headers["User-Agent"] = "opencode-cli/1.0.0";
    else if (clientUaIsCli) headers["User-Agent"] = clientUa;
    else headers["User-Agent"] = OPENCODE_UA;
    return headers;
  }
}
