/**
 * Session Manager for Antigravity Cloud Code
 *
 * Handles session ID generation and caching for prompt caching continuity.
 * Mimics the Antigravity binary behavior: generates a session ID at startup
 * and keeps it for the process lifetime, scoped per account/connection.
 *
 * Reference: antigravity-claude-proxy/src/cloudcode/session-manager.js
 */

import crypto from "crypto";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";

// Runtime storage: Key = connectionId, Value = { sessionId, lastUsed }
import { isObject, isString } from "@/shared/utils/typeChecks.js";const runtimeSessionStore = new Map();

// Periodically evict entries that haven't been used within TTL
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of runtimeSessionStore) {
    if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) {
      runtimeSessionStore.delete(key);
    }
  }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);

// Allow Node.js to exit even if interval is still active
if (cleanupInterval.unref) cleanupInterval.unref();

/**
 * Get or create a session ID for the given connection.
 *
 * The binary generates a session ID once at startup: `rs() + Date.now()`.
 * Since 9router is long-running, we simulate this "per-launch" behavior by
 * storing a generated ID in memory for each connection.
 *
 * - If 9router restarts, the ID changes (matching binary restart behavior).
 * - Within a running instance, the ID is stable for that connection.
 * - This enables prompt caching while using the EXACT random logic of the binary.
 *
 * @param {string} connectionId - The connection identifier (email or unique ID)
 * @returns {string} A stable session ID string matching binary format
 */
export function deriveSessionId(connectionId) {
  if (!connectionId) {
    return generateBinaryStyleId();
  }

  const existing = runtimeSessionStore.get(connectionId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.sessionId;
  }

  // Evict oldest entry if store exceeds max size (safety cap between cleanup cycles)
  const MAX_SESSIONS = 1000;
  if (runtimeSessionStore.size >= MAX_SESSIONS) {
    const oldest = runtimeSessionStore.keys().next().value;
    runtimeSessionStore.delete(oldest);
  }

  const sessionId = generateBinaryStyleId();
  runtimeSessionStore.set(connectionId, { sessionId, lastUsed: Date.now() });
  return sessionId;
}

/**
 * Generate a Session ID using the binary's exact logic.
 * Format: `rs() + Date.now()` where `rs()` is randomUUID
 *
 * @returns {string} A session ID in binary format
 */
export function generateBinaryStyleId() {
  return crypto.randomUUID() + Date.now().toString();
}

/**
 * Clears all session IDs (e.g. useful for testing or explicit reset)
 */
export function clearSessionStore() {
  runtimeSessionStore.clear();
  assistantSessionStore.clear();
  globalContinuationStore.clear();
  requestContinuationStore = new WeakMap();
}

// Conversation-stable session store: Key = hash(scope+assistant text), Value = { sessionId, lastUsed }
const assistantSessionStore = new Map();
const ASSISTANT_MIN_LEN = 50;
const ASSISTANT_CAP_LEN = 50;
const MAX_ASSISTANT_SESSIONS = 5000;

// Direct-session continuation cache: Kiro/KAS `agentContinuationId` binds a
// conversation's agent task across turns so the upstream reuses its warm
// session cache.
//
// Explicit client sessions are cached globally keyed on the full
// [scope, account, model, sessionAffinity] tuple, so a header-backed conversation
// reuses the same continuation across turns. Generated fallback sessions (no
// explicit client session id) are cached in a WeakMap keyed by the inbound
// requestContext: the same context survives BaseExecutor retries/fallbacks, but
// two unrelated inbound requests never share a continuation id. Value for both
// stores is { continuationId, lastUsed }.
const globalContinuationStore = new Map();
const MAX_CONTINUATION_SESSIONS = 5000;

// Request-scoped continuation cache for generated fallback sessions.
// Replaced entirely in clearSessionStore because WeakMap cannot be cleared.
let requestContinuationStore = new WeakMap();

// Client headers/body fields that carry an upstream session id (priority order)
const SESSION_HEADER_KEYS = ["x-session-id", "session-id", "session_id", "x-amp-thread-id", "x-client-request-id"];
const CLAUDE_CODE_SESSION_RE = /_session_([a-f0-9-]+)$/;

function sha16(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// Normalize a session id candidate (trim, length cap)
function normalizeSessionId(value) {
  if (!isString(value)) return null;
  const v = value.trim();
  if (!v || v.length > 256) return null;
  return v;
}

// Extract Claude Code session id from metadata.user_id (_session_{uuid} | JSON {session_id})
function extractClaudeCodeSession(userId) {
  if (!isString(userId) || !userId) return null;
  const m = userId.match(CLAUDE_CODE_SESSION_RE);
  if (m) return m[1];
  if (userId[0] === "{") {
    try {return normalizeSessionId(JSON.parse(userId)?.session_id);} catch {/* noop */}
  }
  return null;
}

// Lowercase-key lookup for raw client headers
function headerValue(headers, key) {
  if (!headers || !isObject(headers)) return null;
  return normalizeSessionId(headers[key] ?? headers[key.toLowerCase()]);
}

// Read client-provided session id from headers/body (no generation)
// Antigravity envelope carries session in request.sessionId; requestId embeds conversation uuid
const ANTIGRAVITY_CONV_RE = /^[a-z]+\/([0-9a-f-]{36})\//i;
function extractAntigravitySession(body) {
  const sid = body?.request?.sessionId;
  if (sid != null && sid !== "") return normalizeSessionId(String(sid));
  const m = isString(body?.requestId) ? body.requestId.match(ANTIGRAVITY_CONV_RE) : null;
  return m ? normalizeSessionId(m[1]) : null;
}

export function extractClientSessionId(headers, body, scope = "") {
  const claude = extractClaudeCodeSession(body?.metadata?.user_id);
  if (claude) return scope === "claude" ? claude : `claude:${claude}`;
  const antigravity = extractAntigravitySession(body);
  if (antigravity) return `antigravity:${antigravity}`;
  for (const key of SESSION_HEADER_KEYS) {
    if (scope === "kiro" && key === "x-client-request-id") continue;
    const v = headerValue(headers, key);
    if (v) return v;
  }
  const fromBody =
  normalizeSessionId(body?.prompt_cache_key) ||
  normalizeSessionId(body?.session_id) ||
  normalizeSessionId(body?.conversation_id) || (
  scope === "kiro" ? null : normalizeSessionId(body?.metadata?.user_id));
  return fromBody || null;
}

export function resolveClientSessionId({ headers, body, scope = "" } = {}) {
  return extractClientSessionId(headers, body, scope);
}

// Accumulate assistant text from OpenAI/Responses-style input/messages (cap-limited)
function accumulateAssistantText(body) {
  const items = Array.isArray(body?.input) ? body.input :
  Array.isArray(body?.messages) ? body.messages : null;
  if (!items) return "";
  let text = "";
  for (const item of items) {
    if (item?.role !== "assistant") continue;
    if (isString(item.content)) text += item.content;else
    if (Array.isArray(item.content)) {
      for (const c of item.content) text += c?.text || c?.output || "";
    }
    if (text.length >= ASSISTANT_CAP_LEN) break;
  }
  return text;
}

// Stable session id keyed on accumulated assistant text (avoids collision on identical first user prompt)
function assistantTextSessionId(scope, body) {
  const text = accumulateAssistantText(body);
  if (text.length < ASSISTANT_MIN_LEN) return null;
  const hash = sha16(`${scope}:${text.slice(0, ASSISTANT_CAP_LEN)}`);
  const existing = assistantSessionStore.get(hash);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.sessionId;
  }
  if (assistantSessionStore.size >= MAX_ASSISTANT_SESSIONS) {
    assistantSessionStore.delete(assistantSessionStore.keys().next().value);
  }
  const sessionId = generateBinaryStyleId();
  assistantSessionStore.set(hash, { sessionId, lastUsed: Date.now() });
  return sessionId;
}

/**
 * Resolve a conversation-stable session id and a provenance hint that tells
 * continuation resolution whether to cache globally (explicit/assistant/
 * workspace/session-derived) or per-request (per-connection generated).
 *
 * @returns {{ sessionId: string, requestScoped: boolean }}
 */
function resolveSessionIdWithProvenance({ headers, body, connectionId, workspaceId, scope = "" } = {}) {
  const client = extractClientSessionId(headers, body, scope);
  if (client) return { sessionId: client, requestScoped: false };
  const fromAssistant = assistantTextSessionId(`${scope}:${connectionId || ""}`, body);
  if (fromAssistant) return { sessionId: fromAssistant, requestScoped: false };
  const ws = normalizeSessionId(workspaceId);
  if (ws) return { sessionId: ws, requestScoped: false };
  return { sessionId: deriveSessionId(connectionId), requestScoped: true };
}

/**
 * Resolve a conversation-stable session id (generalizes Codex resolveCacheSessionId).
 * Priority: client session → accumulated-assistant-text hash → workspaceId → per-connection.
 *
 * @param {object} opts
 * @param {object} [opts.headers] - Raw client request headers (lowercase keys)
 * @param {object} [opts.body] - Parsed request body
 * @param {string} [opts.connectionId] - Connection identifier (fallback scope)
 * @param {string} [opts.workspaceId] - Provider workspace id (account-wide fallback)
 * @param {string} [opts.scope] - Provider scope to isolate cache keys across providers
 * @returns {string} A stable session id
 */
export function resolveSessionId(opts) {
  return resolveSessionIdWithProvenance(opts).sessionId;
}

/**
 * Resolve a stable direct-session continuation id (Kiro `agentContinuationId`).
 *
 * Reuses the same continuation id while the caller stays on the same
 * account + model + session affinity, so the upstream keeps serving from its
 * warm session cache instead of cold-starting a new agent task per turn.
 *
 * Cache key = JSON tuple [scope, connectionId, model, sessionId]. The model
 * and account dimensions are deliberate: a continuation id minted under one
 * model or account is never replayed for another, even when the client
 * session id is identical (explicit session headers are caller-controlled
 * input and must not be able to cross accounts).
 *
 * Generated fallback sessions (no explicit client session id, no assistant
 * text, no workspace id) are cached per requestContext so unrelated
 * headerless first-turn conversations on the same account and model never
 * share a continuation id. The same frozen requestContext survives retries and
 * fallback URL attempts for stable retry identity. All other session kinds
 * (explicit header/body, assistant-derived, workspace) are cached globally
 * so cross-turn reuse continues across inbound requests.
 *
 * If any identity dimension is missing, or the session is generated but no
 * requestContext is available, the caller gets an unstored one-shot id and
 * never falls back to token/email-derived keys.
 *
 * @param {object} opts
 * @param {string} [opts.sessionId] - Resolved session affinity (e.g. the
 *   payload's conversationState.conversationId, itself a resolveSessionId result)
 * @param {string} [opts.connectionId] - Account/connection identifier
 * @param {string} [opts.model] - Resolved upstream model id
 * @param {string} [opts.scope] - Provider scope (e.g. "kiro")
 * @param {object} [opts.requestContext] - Request-scoped metadata from chatCore;
 *   same object survives BaseExecutor retries/fallbacks
 * @param {boolean} [opts.requestScoped=true] - True when the session affinity was
 *   generated per-request (no explicit/assistant/workspace provenance). Defaults
 *   to isolated per-request to avoid accidental sharing when provenance is unknown.
 * @returns {string} A stable continuation id for the affinity tuple, or a
 *   one-shot id when the tuple is incomplete or no requestContext is available
 */
export function resolveContinuationId({ sessionId, connectionId, model, scope = "", requestContext = null, requestScoped = true } = {}) {
  if (!sessionId || !connectionId || !model || !scope) return crypto.randomUUID();
  const key = JSON.stringify([scope, connectionId, model, sessionId]);
  const now = Date.now();

  // Explicit, assistant-derived, and workspace sessions are reused across
  // turns via a global cache.
  if (!requestScoped) {
    const existing = globalContinuationStore.get(key);
    if (existing) {
      existing.lastUsed = now;
      // Refresh recency so the LRU cap evicts genuinely-idle entries first.
      globalContinuationStore.delete(key);
      globalContinuationStore.set(key, existing);
      return existing.continuationId;
    }
    const continuationId = crypto.randomUUID();
    if (globalContinuationStore.size >= MAX_CONTINUATION_SESSIONS) {
      globalContinuationStore.delete(globalContinuationStore.keys().next().value);
    }
    globalContinuationStore.set(key, { continuationId, lastUsed: now });
    return continuationId;
  }

  // Generated/fallback sessions must stay scoped to the inbound request so
  // two independent headerless first-turn conversations never share a
  // continuation id. The same requestContext object survives retries.
  if (!requestContext) return crypto.randomUUID();

  let inner = requestContinuationStore.get(requestContext);
  if (!inner) {
    inner = new Map();
    requestContinuationStore.set(requestContext, inner);
  }

  const existing = inner.get(key);
  if (existing) {
    existing.lastUsed = now;
    inner.delete(key);
    inner.set(key, existing);
    return existing.continuationId;
  }
  const continuationId = crypto.randomUUID();
  if (inner.size >= MAX_CONTINUATION_SESSIONS) {
    inner.delete(inner.keys().next().value);
  }
  inner.set(key, { continuationId, lastUsed: now });
  return continuationId;
}

// Capture session id from request body + credentials (envelope still intact here)
export function captureSessionId(body, credentials, connectionId, scope = "") {
  const { sessionId, requestScoped } = resolveSessionIdWithProvenance({ headers: credentials?.rawHeaders, body, connectionId, scope });
  if (credentials) {
    // True only when resolveSessionId fell back to the generated per-connection
    // branch; explicit/assistant/workspace derived sessions stay global.
    credentials._clientSessionIsGenerated = requestScoped;
  }
  return sessionId;
}

// Convert any session id to Antigravity numeric format "-<int64>" (matches real AG / CLIProxyAPI).
// Already-numeric ids (native AG sessionId) pass through unchanged.
export function toNumericSessionId(sessionId) {
  const v = normalizeSessionId(sessionId);
  if (!v) return null;
  if (/^-?\d+$/.test(v)) return v;
  const h = crypto.createHash("sha256").update(v).digest();
  const n = h.readBigUInt64BE(0) & 0x7fffffffffffffffn;
  return `-${n.toString()}`;
}

// Cleanup expired assistant-session entries
const assistantCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of assistantSessionStore) {
    if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) assistantSessionStore.delete(key);
  }
  for (const [key, entry] of globalContinuationStore) {
    if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) globalContinuationStore.delete(key);
  }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (assistantCleanup.unref) assistantCleanup.unref();