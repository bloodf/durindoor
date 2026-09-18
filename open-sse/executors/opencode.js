import crypto from "crypto";

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { stripUnsupportedParams } from "../translator/concerns/paramSupport.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { normalizeResponsesTools, sanitizeResponsesItems } from "./opencode-go.js";

/**
 * OpenCode free-tier executor (upstream #4041-adjacent cluster: 93837af0 +
 * 6091ff59, plus PR #4155).
 *
 * OpenCode Zen validates free-tier (no-auth) requests and 403s
 * (`FreeTierError`) unless three things hold:
 *
 * 1. `x-opencode-session` matches the canonical `ses_<12 hex><14 base62>`
 *    shape (`OPENCODE_SESSION_RE`) — an arbitrary opaque id is rejected.
 * 2. `User-Agent` looks like `opencode/<version>` with version >= 1.17.0.
 * 3. Muse Responses requests declare the `bash`/`read` fingerprint tools
 *    upstream's own CLI always sends, even when the caller already supplied
 *    its own tools (#4155) — cloaked as unusable decoys so a real client
 *    tool of the same name still wins.
 *
 * Session identity is resolved once per request in `prepareRequestCredentials`
 * (called from `execute`) onto a request-local credentials copy, mirroring
 * opencode-go.js: no session state lives on this singleton executor, so
 * concurrent requests never race on a shared field.
 */
const OPENCODE_UA = "opencode/1.18.31";
const MESSAGES_MODELS = new Set();

export const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SESSION_HEADER = "x-opencode-session";
const SESSION_FIELD = "_opencodeSession";

// OpenCode Zen requires User-Agent: opencode/<major>.<minor>[.<patch>] with
// major.minor >= 1.17 — anything older 426s, anything unversioned 403s.
function hasValidOpencodeVersion(ua) {
  const m = String(ua || "").match(/opencode\/(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major > 1 || (major === 1 && minor >= 17);
}

// OpenCode free tier requires both 'bash' and 'read' in tools payload.
// Injected as cloaked decoy tools so external CLI tools (e.g. Claude Code's Bash/Read)
// take precedence while satisfying upstream verification.
export const OPENCODE_DECOY_CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "This tool is currently unavailable and must not be used.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "This tool is currently unavailable and must not be used.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export const OPENCODE_DECOY_RESPONSES_TOOLS = [
  {
    type: "function",
    name: "bash",
    description: "This tool is currently unavailable and must not be used.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "read",
    description: "This tool is currently unavailable and must not be used.",
    parameters: { type: "object", properties: {} },
  },
];

// #4155: cloak decoy tools unconditionally, even when the caller already
// supplied its own tools — the free tier requires the bash/read fingerprint
// on every request, not only tool-less ones. A real client tool of the same
// name is left untouched (only missing decoys are appended).
function cloakOpencodeTools(body, isResponses) {
  if (!body) return;
  if (isResponses) {
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    if (!hasTools) body.tools = [];
    // #4146: a malformed tool entry (null/undefined) must not throw here — treat
    // it as unnamed so it's simply ignored by the decoy-name check below.
    const exactNames = new Set(body.tools.map((t) => t?.name || t?.function?.name || ""));
    for (const tool of OPENCODE_DECOY_RESPONSES_TOOLS) {
      if (!exactNames.has(tool.name)) body.tools.push({ ...tool });
    }
    // Only default tool_choice when the caller sent none: forcing "auto" onto a
    // caller who already supplied its own tools would override their intent
    // (e.g. an explicit "required" or a named tool_choice).
    if (!hasTools && !body.tool_choice) body.tool_choice = "auto";
  } else {
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    if (!hasTools) {
      body.tools = OPENCODE_DECOY_CHAT_TOOLS.map((t) => ({ ...t, function: { ...t.function } }));
      if (!body.tool_choice) body.tool_choice = "none";
    } else {
      const exactNames = new Set(body.tools.map((t) => t?.function?.name || t?.name || ""));
      for (const tool of OPENCODE_DECOY_CHAT_TOOLS) {
        if (!exactNames.has(tool.function.name)) {
          body.tools.push({ ...tool, function: { ...tool.function } });
        }
      }
    }
  }
}

function normalizeSession(value) {
  if (!isString(value)) return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 256 ? trimmed : null;
}

function readHeader(rawHeaders, name) {
  if (!rawHeaders) return null;
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (key.toLowerCase() === name) return value;
  }
  return null;
}

// A caller-supplied session header is only trusted when it already matches
// the canonical shape — otherwise it gets translated below like any other
// seed, so a spoofed/legacy header can't skip validation.
function nativeSession(rawHeaders) {
  const normalized = normalizeSession(readHeader(rawHeaders, SESSION_HEADER));
  return normalized && OPENCODE_SESSION_RE.test(normalized) ? normalized : null;
}

// Deterministic translation from an arbitrary source string into the
// canonical `ses_<12 hex><14 base62>` shape OpenCode Zen's free tier
// validates. Namespacing by clientTool isolates different downstream agents
// that happen to reuse the same raw conversation id.
function canonicalSessionId(source, clientTool) {
  const digest = crypto.createHash("sha256")
    .update(`opencode\0${clientTool || "generic"}\0${source}`)
    .digest();
  const timeHex = digest.subarray(0, 6).toString("hex");
  let randomPart = "";
  for (let i = 6; i < 20; i++) randomPart += BASE62_CHARS[digest[i] % 62];
  return `ses_${timeHex}${randomPart}`;
}

// Fallback generator for contexts with no resolvable session seed at all
// (e.g. buildHeaders invoked standalone, outside execute()).
function generateSessionId() {
  const bytes = crypto.randomBytes(20);
  const timeHex = bytes.subarray(0, 6).toString("hex");
  let randomPart = "";
  for (let i = 6; i < 20; i++) randomPart += BASE62_CHARS[bytes[i] % 62];
  return `ses_${timeHex}${randomPart}`;
}

function generateRequestId() {
  const bytes = crypto.randomBytes(20);
  const timeHex = bytes.subarray(0, 6).toString("hex");
  let randomPart = "";
  for (let i = 6; i < 20; i++) randomPart += BASE62_CHARS[bytes[i] % 62];
  return `msg_${timeHex}${randomPart}`;
}

function trustedSessionKey(credentials, requestContext, fallback) {
  const connectionId = isString(credentials?.connectionId) && credentials.connectionId.trim() ?
  credentials.connectionId.trim() :
  null;
  if (!connectionId) return fallback;
  const sessionId = isString(requestContext?.sessionId) && requestContext.sessionId.trim() ?
  requestContext.sessionId.trim() :
  null;
  return JSON.stringify([connectionId, sessionId]);
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

// Every no-auth caller shares the literal connectionId "noauth" (there is no
// per-account row for the public fallback — src/sse/services/auth.js
// buildNoAuthCredential/buildOptionalNoAuthCredential). trustedSessionKey and
// chatCore's own resolveSessionId(connectionId) fallback both derive from that
// same shared literal on a first turn with no client session hint, so two
// unrelated anonymous callers can land on the identical canonical session.
// The unspoofable TCP-peer IP (same signal PR #3321 already trusts for
// free-tier bucketing, above) is the only other caller-distinguishing signal
// available at this point, so anonymous identity folds it in as an extra hash
// dimension. This narrows the collision from "every anonymous caller on this
// instance" to "every anonymous caller sharing one public IP" — still a real
// collision behind NAT/VPN/CGNAT, and still open when the peer IP itself is
// private (no reverse proxy, e.g. plain local dev) or unavailable; there is
// no stronger identity signal available at the executor layer to close that
// gap (see PR report for the full trace and the discarded alternatives).
function anonymousCallerIp(rawHeaders) {
  const raw = (readHeader(rawHeaders, "x-9r-real-ip") || readHeader(rawHeaders, "x-real-ip") || "").trim();
  return raw && !isPrivateIp(raw) ? raw : null;
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
    this._privateSessionKey = crypto.randomUUID();
  }

  /**
   * Resolve the free-tier session identity onto a request-local credentials
   * copy (never mutates the shared `credentials` object or `this`). A valid
   * native `x-opencode-session` header wins as-is; otherwise the
   * chatCore-forwarded `providerSessionId`/connection identity is translated
   * into the canonical shape.
   *
   * Anonymous (no-auth) callers all share the literal connectionId "noauth",
   * so `source` alone can be identical across unrelated callers on a first
   * turn — see `anonymousCallerIp`. The peer IP, when available and public,
   * is folded into the hash input so different anonymous callers still land
   * on different sessions; this is a mitigation, not a full fix (documented
   * on `anonymousCallerIp`).
   */
  prepareRequestCredentials({ body, credentials, providerSessionId, clientTool, requestContext } = {}) {
    const sourceCredentials = credentials || {};
    const headerSource = sourceCredentials.rawHeaders || requestContext?.clientHeaders;
    const native = nativeSession(headerSource);
    const isAnonymous = sourceCredentials.id === "noauth" || sourceCredentials.connectionId === "noauth";
    const identityIp = isAnonymous ? anonymousCallerIp(headerSource) : null;
    const source = normalizeSession(providerSessionId) ||
    trustedSessionKey(sourceCredentials, requestContext, this._privateSessionKey);
    const hashInput = identityIp ? `${source}\0ip:${identityIp}` : source;
    return {
      ...sourceCredentials,
      [SESSION_FIELD]: native || canonicalSessionId(hashInput, clientTool),
    };
  }

  async execute(args) {
    return super.execute({ ...args, credentials: this.prepareRequestCredentials(args) });
  }

  transformRequest(model, body, stream, credentials, requestContext = null) {
    delete body.client_metadata;
    // Zen rejects non-streaming requests on free models with 403 FreeTierError;
    // always stream upstream and let chatCore's forceStream registry flag
    // aggregate the SSE back to JSON for non-streaming clients. The Codex
    // compact-responses contract stays unary — chatCore forces stream:false
    // for it unconditionally (ignores forceStream), so it can never be
    // satisfied here. Fail fast with a clear message instead of silently
    // deleting body.stream and letting Zen 403 with an opaque FreeTierError.
    if (requestContext?.compact === true) {
      throw new Error(
        "OpenCode free tier requires a streaming upstream dispatch and is incompatible with the compact-responses endpoint (stream is forced off there); use the regular /v1/responses or /v1/chat/completions endpoint for opencode models instead."
      );
    }
    if (body) body.stream = true;
    if (/muse/i.test(model) && body) {
      body.store = false;
      normalizeResponsesTools(body);
      sanitizeResponsesItems(body);
      cloakOpencodeTools(body, true);
    } else if (body) {
      cloakOpencodeTools(body, false);
    }
    const transformed = injectReasoningContent({ provider: this.provider, model, body });
    /** Muse Responses rejects every Chat and Responses token-cap spelling. */
    return /muse/i.test(model) ? stripUnsupportedParams(this.provider, model, transformed) : transformed;
  }

  /** OpenCode Muse rejects Chat Completions and is served only by Responses. */
  buildUrl(model) {
    const base = this.config.baseUrl;
    if (/muse/i.test(model)) return `${base}/zen/v1/responses`;
    return MESSAGES_MODELS.has(model) ?
    `${base}/zen/v1/messages` :
    `${base}/zen/v1/chat/completions`;
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
      "Accept": stream ? "text/event-stream" : "*/*"
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
      "x-opencode-session": credentials?.[SESSION_FIELD] ?? generateSessionId(),
      "x-opencode-request": generateRequestId(),
      "x-opencode-project": "global"
    };
    const rawIp = (clientHeaders.get("x-9r-real-ip") || clientHeaders.get("x-real-ip") || "").trim();
    if (rawIp && !isPrivateIp(rawIp)) headers["x-real-ip"] = rawIp;
    if (synthesizeCli && !clientUaIsCli) headers["User-Agent"] = "opencode-cli/1.0.0";else
    if (clientUaIsCli) headers["User-Agent"] = clientUa;else
    if (hasValidOpencodeVersion(clientUa)) headers["User-Agent"] = clientUa;else
    headers["User-Agent"] = OPENCODE_UA;
    return headers;
  }
}
