import crypto from "crypto";

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { stripUnsupportedParams } from "../translator/concerns/paramSupport.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { normalizeResponsesTools, sanitizeResponsesItems } from "./opencode-go.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import { applyFingerprintTools } from "../utils/opencodeFingerprint.js";

/**
 * OpenCode free-tier executor (upstream #4041-adjacent cluster: 93837af0 +
 * 6091ff59 + 0c6ab4f9 + 2b65c49, PR #4155, then the OpenCode v2 move in
 * 5bdcd5e7 + ef4679df + 483c10f5).
 *
 * Since 2026-10-14 the free tier lives on /inference/v1; /zen/v1 answers every
 * free request with 403 FreeTierError. The v2 gate requires:
 *
 * 1. `x-opencode-session` (mirrored as `x-opencode-session-id`,
 *    `x-session-affinity`, `x-session-id`) in the canonical
 *    `ses_<12 hex><14 base62>` shape, whose hex prefix is the CLI's inverted
 *    `timeMs * 0x1000 + counter` with a small counter (`descendingTimeHex`).
 *    Any `x-opencode-request` header is rejected, so none is sent.
 * 2. A v2 `User-Agent`: `opencode/<channel>/<major>.<minor>.<patch>/<client>`
 *    with major >= 2.
 * 3. OpenCode's own `read` and `shell` tool definitions, verbatim (see
 *    utils/opencodeFingerprint.js), on every request.
 *
 * Session identity is resolved once per request in `prepareRequestCredentials`
 * (called from `execute`) onto a request-local credentials copy: no session
 * state lives on this singleton executor. The session is a deterministic hash
 * of `[connectionId, requestContext.sessionId]` (`canonicalSessionId` /
 * `trustedSessionKey`), so one identity always derives the same session with
 * no cache (upstream 0c6ab4f9's guarantee without its Map).
 *
 * Anonymous (no-auth) callers all share the literal connectionId "noauth", so
 * the session source alone can be identical across unrelated callers on a
 * first turn — see `anonymousCallerIp`. The public peer IP, when available, is
 * folded into the hash input so different anonymous callers land on different
 * sessions; this is a mitigation, not a full fix.
 *
 * Union Alpha (upstream 2b65c49) is a routing concern: `MESSAGES_MODELS` pins
 * it to /inference/v1/messages (Claude wire format) in `buildUrl`, and
 * `buildHeaders` only adds `anthropic-version` on that route.
 */
// OpenCode v2 UA shape (upstream 5bdcd5e7): opencode/<channel>/<version>/<client>.
// Upstream rejects the v1 "opencode/1.18.x" form with 403 FreeTierError since
// 2026-10-14.
export const OPENCODE_UA = "opencode/latest/2.0.26/cli";
const OPENCODE_CLIENT = "cli";
// Models served by /inference/v1/messages (Claude wire format); every other model
// stays on /chat/completions (or /responses, gated separately by /muse/).
const MESSAGES_MODELS = new Set(["union-alpha"]);

export const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SESSION_HEADER = "x-opencode-session";
const SESSION_FIELD = "_opencodeSession";

// Session prefix = 12 hex of ~(timeMs * 0x1000 + counter), low 48 bits, like the
// CLI. Upstream decodes it and rejects a non-small counter with 403
// FreeTierError (live probes upstream: counter 0-16 pass, >=100 fail).
const SESSION_PREFIX_MASK = (1n << 48n) - 1n;
const SESSION_TIME_MASK = (1n << 36n) - 1n;

function descendingTimeHex(time, counter) {
  return (~(BigInt(time) * 0x1000n + BigInt(counter)) & SESSION_PREFIX_MASK).
  toString(16).
  padStart(12, "0");
}

// v2 CLI UA only: the whole header must be the v2 shape with major >= 2.
function hasValidOpencodeVersion(ua) {
  const m = String(ua || "").match(/^opencode\/[a-z0-9-]+\/(\d+)\.\d+\.\d+\/[a-z0-9-]+$/i);
  return !!m && parseInt(m[1], 10) >= 2;
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
  const digest = crypto.createHash("sha256").
  update(`opencode\0${clientTool || "generic"}\0${source}`).
  digest();
  // Deterministic time field from the digest, counter pinned to 1 (what the
  // CLI sends on a session's first id).
  const time = BigInt(`0x${digest.subarray(0, 5).toString("hex")}`) & SESSION_TIME_MASK;
  let randomPart = "";
  for (let i = 6; i < 20; i++) randomPart += BASE62_CHARS[digest[i] % 62];
  return `ses_${descendingTimeHex(time, 1)}${randomPart}`;
}

// Fallback generator for contexts with no resolvable session seed at all
// (e.g. buildHeaders invoked standalone, outside execute()).
function generateSessionId() {
  const bytes = crypto.randomBytes(14);
  let randomPart = "";
  for (let i = 0; i < 14; i++) randomPart += BASE62_CHARS[bytes[i] % 62];
  return `ses_${descendingTimeHex(Date.now(), 1)}${randomPart}`;
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

// Rename map (sent alias -> caller name) for chatCore's response-side restore.
// Non-enumerable, so it never reaches the provider JSON (same contract as
// antigravity.js); attached last because injectReasoningContent may copy body.
function withToolNameMap(body, toolNameMap) {
  if (body && toolNameMap?.size) {
    Object.defineProperty(body, "_toolNameMap", { value: toolNameMap, configurable: true });
  }
  return body;
}

// Strip the thinking suffix "model(level)" so quirk checks hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
    this._privateSessionKey = crypto.randomUUID();
  }

  /**
   * Resolve the free-tier session onto a request-local credentials copy
   * (never mutates the shared `credentials` object or `this`). A valid native
   * `x-opencode-session` header wins as-is; otherwise the chatCore-forwarded
   * `providerSessionId`/connection identity is translated into the canonical
   * shape deterministically (see class doc). Anonymous callers fold in their
   * public peer IP (see `anonymousCallerIp`).
   */
  prepareRequestCredentials({ credentials, providerSessionId, clientTool, requestContext } = {}) {
    const sourceCredentials = credentials || {};
    const headerSource = sourceCredentials.rawHeaders || requestContext?.clientHeaders;
    const native = nativeSession(headerSource);
    const isAnonymous = sourceCredentials.id === "noauth" || sourceCredentials.connectionId === "noauth";
    const identityIp = isAnonymous ? anonymousCallerIp(headerSource) : null;
    const source = normalizeSession(providerSessionId) ||
    trustedSessionKey(sourceCredentials, requestContext, this._privateSessionKey);
    const hashInput = identityIp ? `${source}\0ip:${identityIp}` : source;
    const session = native || canonicalSessionId(hashInput, clientTool);
    return {
      ...sourceCredentials,
      [SESSION_FIELD]: session,
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
      // Strips prior-turn `reasoning` items and their encrypted_content (port of
      // decolua/9router eafac37d) as part of its existing item-shape pass.
      sanitizeResponsesItems(body);
      const toolNameMap = applyFingerprintTools(body, "responses");
      // Upstream #4128: the real client pins its Responses prompt cache to the
      // session it is running under. Mirror that with the same canonical
      // session id, so repeated turns of one conversation share a cache entry.
      // Only ever fills a missing value: a caller-supplied key wins.
      const session = credentials?.[SESSION_FIELD];
      // A whitespace-only key ("   ") is still caller-supplied by the null
      // check above but is not a usable cache key — Zen can 400 on a blank
      // one. Treat trim-empty the same as missing so the session pin runs.
      const hasUsableCacheKey = isString(body.prompt_cache_key) ?
      body.prompt_cache_key.trim() !== "" :
      body.prompt_cache_key !== undefined && body.prompt_cache_key !== null;
      if (session && !hasUsableCacheKey) {
        body.prompt_cache_key = session;
      }
      // OpenCode Free 400s muse-spark-1.3-contributor-free when tool_choice is
      // anything but "auto" (port of decolua/9router aa14ef72). The fingerprint
      // pass above only defaults a missing tool_choice; this demotes an explicit
      // non-auto one regardless of whether the caller also sent tools.
      if ("tool_choice" in body && body.tool_choice !== "auto" &&
      this.config.quirks?.forceAutoToolChoiceModels?.includes(baseModelId(model))) {
        body.tool_choice = "auto";
      }
      return withToolNameMap(stripUnsupportedParams(this.provider, model,
        injectReasoningContent({ provider: this.provider, model, body })), toolNameMap);
    }
    if (MESSAGES_MODELS.has(model)) {
      // Claude Messages bodies have no reasoning_content field; the registry's
      // reasoningInject placeholder is Chat Completions only.
      return withToolNameMap(body, body ? applyFingerprintTools(body, "claude") : null);
    }
    const toolNameMap = body ? applyFingerprintTools(body, "chat") : null;
    return withToolNameMap(injectReasoningContent({ provider: this.provider, model, body }), toolNameMap);
  }

  /**
   * OpenCode Muse rejects Chat Completions and is served only by Responses.
   * The free tier moved from /zen/v1 to /inference/v1 (OpenCode v2, upstream
   * 5bdcd5e7); /zen/v1 now answers every free request with 403 FreeTierError.
   */
  buildUrl(model) {
    const base = this.config.baseUrl;
    if (/muse/i.test(model)) return `${base}/inference/v1/responses`;
    return MESSAGES_MODELS.has(model) ?
    `${base}/inference/v1/messages` :
    `${base}/inference/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true, requestContext = null, model = null) {
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
    if (MESSAGES_MODELS.has(model)) baseHeaders["anthropic-version"] = ANTHROPIC_API_VERSION;
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
    // Mirrors the v2 CLI: the session travels under all four names, and any
    // x-opencode-request (v1 only) is answered with 403.
    const session = credentials?.[SESSION_FIELD] ?? generateSessionId();
    const headers = {
      ...baseHeaders,
      "x-opencode-client": OPENCODE_CLIENT,
      "x-opencode-session": session,
      "x-opencode-session-id": session,
      "x-session-affinity": session,
      "x-session-id": session,
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
