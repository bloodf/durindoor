import crypto from "crypto";

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { stripUnsupportedParams } from "../translator/concerns/paramSupport.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { normalizeResponsesTools, sanitizeResponsesItems } from "./opencode-go.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";

/**
 * OpenCode free-tier executor (upstream #4041-adjacent cluster: 93837af0 +
 * 6091ff59 + 0c6ab4f9 + 2b65c49, plus PR #4155).
 *
 * OpenCode Zen validates free-tier (no-auth) requests and 403s
 * (`FreeTierError`) unless three things hold:
 *
 * 1. `x-opencode-session` matches the canonical `ses_<12 hex><14 base62>`
 *    shape (`OPENCODE_SESSION_RE`) — an arbitrary opaque id is rejected.
 * 2. `User-Agent` looks like `opencode/<version>` with version >= 1.17.0.
 * 3. Every request declares the `bash`/`glob`/`grep`/`read` fingerprint tools
 *    upstream's own CLI always sends (#4188), even when the caller already
 *    supplied its own tools (#4155) — cloaked as unusable decoys so a real
 *    client tool of the same name still wins.
 *
 * Session identity is resolved once per request in `prepareRequestCredentials`
 * (called from `execute`) onto a request-local credentials copy, mirroring
 * opencode-go.js: no session state lives on this singleton executor, so
 * concurrent requests never race on a shared field.
 *
 * Stable session per identity (upstream 0c6ab4f9): upstream introduces a
 * process-lifetime `Map` cache (identity -> random session, TTL-evicted)
 * because its sessions are random and must be remembered to be reused. This
 * fork already reuses one session per identity without a cache: `session`
 * above is a deterministic hash of `[connectionId, requestContext.sessionId]`
 * (`canonicalSessionId`/`trustedSessionKey`), so the same identity always
 * derives the same session with no stored state, no TTL, and no memory
 * growth — a superset of upstream's guarantee, and already covered by the
 * "uses trusted connection identity" tests below. What upstream also adds
 * that this fork lacked is a deterministic `x-opencode-request` per logical
 * turn (`deriveRequestId`): every dispatch used to mint a fresh random id
 * even on a credential-refresh retry of the exact same message, unlike the
 * real CLI's stable per-turn id. `x-opencode-request` is now derived the
 * same way as the session (hash of session + last user message text), so
 * retries of one turn share an id and a new turn gets a new one.
 *
 * Anonymous (no-auth) callers all share the literal connectionId "noauth",
 * so the session source alone can be identical across unrelated callers on a
 * first turn — see `anonymousCallerIp`. The peer IP, when available and
 * public, is folded into the single `hashInput` that `canonicalSessionId`
 * consumes, so different anonymous callers land on different sessions; this
 * is a mitigation, not a full fix (documented on `anonymousCallerIp`).
 * `deriveRequestId` seeds on the resulting `session` (not a second parallel
 * hashInput), so an anonymous caller's `x-opencode-request` inherits the
 * same per-IP isolation as its `x-opencode-session` with one derivation to
 * keep in sync, not two.
 *
 * Union Alpha (upstream 2b65c49) is orthogonal to all of the above: it is a
 * routing concern (which endpoint a model's wire format needs), not a
 * session/cloaking/streaming one. `MESSAGES_MODELS` pins it to
 * /zen/v1/messages (Claude wire format) in `buildUrl`, and `buildHeaders`
 * only adds `anthropic-version` on that route; every other free-tier
 * behavior in this file (session identity, cloaking, forced streaming, the
 * compact-endpoint guard) applies to it exactly like any other non-Muse
 * model.
 */
// Full official-client identity string (upstream #4128). Zen's gate reads the
// whole User-Agent, not just the version token: the real CLI advertises its
// ai-sdk and runtime alongside `opencode/<version>`, so a bare `opencode/1.18.31`
// is a weaker fingerprint than the client it is standing in for.
export const OPENCODE_UA = "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14";
// Models served by /zen/v1/messages (Claude wire format); every other model
// stays on /chat/completions (or /responses, gated separately by /muse/).
const MESSAGES_MODELS = new Set(["union-alpha"]);

export const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
export const OPENCODE_REQUEST_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SESSION_HEADER = "x-opencode-session";
const REQUEST_HEADER = "x-opencode-request";
const SESSION_FIELD = "_opencodeSession";
const REQ_FIELD = "_opencodeRequest";
const LAST_TEXT_MAX_LEN = 600;

// OpenCode Zen requires User-Agent: opencode/<major>.<minor>[.<patch>] with
// major.minor >= 1.17 — anything older 426s, anything unversioned 403s.
function hasValidOpencodeVersion(ua) {
  // Token-bounded: a bare "opencode/X.Y[.Z]" segment, not a substring of a
  // longer token like "not-opencode/1.18.31" or "opencode/1.18.31extra" -
  // either would let a header Zen never emitted pass through unchanged.
  const m = String(ua || "").match(/(?:^|\s)opencode\/(\d+)\.(\d+)(?:\.(\d+))?(?=\s|$)/i);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major > 1 || (major === 1 && minor >= 17);
}

// Upstream free-tier gate (#4188): Zen rejects a request whose tools payload
// does not carry the four file-search tools the official CLI always declares.
// Live bisection upstream: 0-3 of {bash, glob, grep, read} 403s FreeTierError on
// both /chat/completions and /responses, the full quartet passes; extra caller
// tools are allowed, invented names are not.
//
// Injected as cloaked decoys: the description tells the model the tool is
// unusable, so it never emits a call the downstream client cannot service, and
// a real client tool of the same name always wins (only missing names are
// appended).
const OPENCODE_FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"];
const OPENCODE_DECOY_DESCRIPTION = "This tool is currently unavailable and must not be used.";

export const OPENCODE_DECOY_CHAT_TOOLS = OPENCODE_FINGERPRINT_TOOLS.map((name) => ({
  type: "function",
  function: {
    name,
    description: OPENCODE_DECOY_DESCRIPTION,
    parameters: { type: "object", properties: {} }
  }
}));

export const OPENCODE_DECOY_RESPONSES_TOOLS = OPENCODE_FINGERPRINT_TOOLS.map((name) => ({
  type: "function",
  name,
  description: OPENCODE_DECOY_DESCRIPTION,
  parameters: { type: "object", properties: {} }
}));

// Claude Messages wire-shaped decoys for MESSAGES_MODELS (union-alpha):
// {name, input_schema}, not the OpenAI {type, function} envelope.
export const OPENCODE_DECOY_CLAUDE_TOOLS = OPENCODE_FINGERPRINT_TOOLS.map((name) => ({
  name,
  description: OPENCODE_DECOY_DESCRIPTION,
  input_schema: { type: "object", properties: {} }
}));

// #4155: cloak decoy tools unconditionally, even when the caller already
// supplied its own tools — the free tier requires the fingerprint quartet on
// every request, not only tool-less ones. A real client tool of the same name
// is left untouched (only missing decoys are appended). `format` is
// "responses" | "claude" | "chat" — MESSAGES_MODELS (union-alpha) is a Claude
// Messages body and must get Claude-shaped tools and a Claude tool_choice,
// never the OpenAI Chat envelope the "chat" branch writes; a mixed body of
// Claude `input_schema` tools plus OpenAI `function` tools, or a string
// tool_choice, is rejected by /zen/v1/messages.
function cloakOpencodeTools(body, format) {
  if (!body) return;
  if (format === "responses") {
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
  } else if (format === "claude") {
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    if (!hasTools) body.tools = [];
    const exactNames = new Set(body.tools.map((t) => t?.name || ""));
    for (const tool of OPENCODE_DECOY_CLAUDE_TOOLS) {
      if (!exactNames.has(tool.name)) body.tools.push({ ...tool });
    }
    if (!hasTools && !body.tool_choice) body.tool_choice = { type: "none" };
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

// Same trust rule as nativeSession: a caller-supplied request id is only
// honored when it already matches the canonical shape.
function nativeRequestId(rawHeaders) {
  const normalized = normalizeSession(readHeader(rawHeaders, REQUEST_HEADER));
  return normalized && OPENCODE_REQUEST_RE.test(normalized) ? normalized : null;
}

// Extract the current turn's user-facing text (Chat `messages` or Responses
// `input`) so the request id can be derived from it. Bounded to the tail of
// the text — only used as hash input, never sent upstream.
function lastUserText(body) {
  if (!body) return "";
  const arr = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : null;
  if (!arr) return isString(body.input) ? body.input.slice(-LAST_TEXT_MAX_LEN) : "";
  for (let i = arr.length - 1; i >= 0; i--) {
    const msg = arr[i];
    if (!msg) continue;
    if (msg.role && msg.role !== "user") continue;
    const content = msg.content;
    if (isString(content) && content.trim()) return content.trim().slice(-LAST_TEXT_MAX_LEN);
    if (Array.isArray(content)) {
      const text = content.map((part) => (isString(part) ? part : part?.text || part?.input_text || "")).join(" ").trim();
      if (text) return text.slice(-LAST_TEXT_MAX_LEN);
    }
  }
  return "";
}

// The real CLI sends the current user message id (stable per turn, same on
// retries) as x-opencode-request. Derive it deterministically from the
// session plus the last user message so credential-refresh retries of the
// same turn reuse the same id; a body with no readable user text (or a new
// turn) falls back to a fresh random id. Seeding on the final session id
// (not a second parallel hashInput) means an anonymous caller's request id
// inherits whatever isolation the session already has — including the
// peer-IP fold-in below — with no separate derivation to keep in sync.
function deriveRequestId(sessionId, body) {
  const text = lastUserText(body);
  if (!text) return generateRequestId();
  const digest = crypto.createHash("sha256")
    .update(`opencode-req\0${sessionId || ""}\0${text}`)
    .digest();
  const timeHex = digest.subarray(0, 6).toString("hex");
  let randomPart = "";
  for (let i = 6; i < 20; i++) randomPart += BASE62_CHARS[digest[i] % 62];
  return `msg_${timeHex}${randomPart}`;
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
   * Resolve the free-tier session + request identity onto a request-local
   * credentials copy (never mutates the shared `credentials` object or
   * `this`). A valid native `x-opencode-session` header wins as-is;
   * otherwise the chatCore-forwarded `providerSessionId`/connection identity
   * is translated into the canonical shape — deterministically, so the same
   * identity always derives the same session with no cache to evict (see
   * class doc). `x-opencode-request` is likewise a valid native header, else
   * derived from the session plus the current turn's text so retries of one
   * turn share an id (upstream 0c6ab4f9).
   *
   * Anonymous (no-auth) callers all share the literal connectionId "noauth",
   * so `source` alone can be identical across unrelated callers on a first
   * turn — see `anonymousCallerIp`. The peer IP, when available and public,
   * is folded into the hash input so different anonymous callers still land
   * on different sessions (and, transitively through `deriveRequestId`
   * seeding on the resulting session, different request ids too); this is a
   * mitigation, not a full fix (documented on `anonymousCallerIp`).
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
    const session = native || canonicalSessionId(hashInput, clientTool);
    return {
      ...sourceCredentials,
      [SESSION_FIELD]: session,
      [REQ_FIELD]: nativeRequestId(headerSource) || deriveRequestId(session, body),
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
      cloakOpencodeTools(body, "responses");
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
      // anything but "auto" (port of decolua/9router aa14ef72). cloakOpencodeTools
      // above only defaults a missing tool_choice (and only when the caller sent
      // no tools, #4146); this demotes an explicit non-auto one that survives
      // cloaking regardless of whether the caller also sent tools.
      if ("tool_choice" in body && body.tool_choice !== "auto" &&
      this.config.quirks?.forceAutoToolChoiceModels?.includes(baseModelId(model))) {
        body.tool_choice = "auto";
      }
    } else if (body) {
      cloakOpencodeTools(body, MESSAGES_MODELS.has(model) ? "claude" : "chat");
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
    const headers = {
      ...baseHeaders,
      "x-opencode-client": "desktop",
      "x-opencode-session": credentials?.[SESSION_FIELD] ?? generateSessionId(),
      "x-opencode-request": credentials?.[REQ_FIELD] ?? generateRequestId(),
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
