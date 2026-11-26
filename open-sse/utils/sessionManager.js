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
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
const runtimeSessionStore = new Map();

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
    /** Keep Map iteration order in access order for the capped LRU eviction below. */
    runtimeSessionStore.delete(connectionId);
    runtimeSessionStore.set(connectionId, existing);
    return existing.sessionId;
  }

  // Evict the least-recently-used entry if the store reaches its safety cap.
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
}

// Conversation-stable session store: Key = hash(scope+assistant text), Value = { sessionId, lastUsed }
const assistantSessionStore = new Map();
const ASSISTANT_MIN_LEN = 50;
const ASSISTANT_CAP_LEN = 50;
const MAX_ASSISTANT_SESSIONS = 5000;

// Client headers/body fields that carry an upstream session id (priority order)
const SESSION_HEADER_KEYS = ["x-session-id", "session-id", "session_id", "x-amp-thread-id", "x-client-request-id"];
const CLAUDE_CODE_SESSION_RE = /_session_([a-f0-9-]+)$/;
const CLAUDE_CODE_SESSION_HEADER = "x-claude-code-session-id";

function sha16(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// Normalize a session id candidate (trim, length cap). Ids end up in upstream
// headers, which reject code points above U+00FF, so such an id is hashed: one
// conversation keeps one stable, header-safe value (OmniRoute #21148). UTF-16
// input keeps lone surrogates distinct. The `sid_` prefix is reserved: a literal
// id carrying it is hashed too, so it cannot name another id's session.
function normalizeSessionId(value) {
  if (!isString(value)) return null;
  const v = value.trim();
  if (!v || v.length > 256 || /[\u0000-\u001f\u007f]/.test(v)) return null;
  if (!v.startsWith("sid_") && !/[^\u0000-\u00ff]/.test(v)) return v;
  return `sid_${crypto.createHash("sha256").update(v, "utf16le").digest("hex").slice(0, 32)}`;
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

// Reserve the agent delimiter in both segments so distinct header sessions cannot collide.
function headerSessionId(id, headers, body) {
  const escape = (value) => value.replaceAll(":agent~", ":agent~~").replaceAll(":agent:", ":agent~;");
  const agent = [normalizeSessionId(body?.metadata?.agent_id), normalizeSessionId(body?.metadata?.subagent_id),
    headerValue(headers, "x-claude-code-agent-id"), headerValue(headers, "x-agent-id"),
    normalizeSessionId(body?.request?.metadata?.agent_id), normalizeSessionId(body?.request?.metadata?.subagent_id)].find((value) => value && value !== "main");
  return agent ? `${escape(id)}:agent:${escape(agent)}` : escape(id);
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
  // Claude Code also sends the session in a header that survives translation to
  // formats that drop metadata (e.g. Responses API). Header fallback is Claude-scope only.
  const claude = extractClaudeCodeSession(body?.metadata?.user_id) || (
  scope === "claude" ? headerValue(headers, CLAUDE_CODE_SESSION_HEADER) : null);
  if (claude) {
    const id = scope === "claude" ? claude : `claude:${claude}`;
    return headerSessionId(id, headers, body);
  }
  const antigravity = extractAntigravitySession(body);
  if (antigravity) return `antigravity:${antigravity}`;
  for (const key of SESSION_HEADER_KEYS) {
    if (scope === "kiro" && key === "x-client-request-id") continue;
    const v = headerValue(headers, key);
    if (v) return headerSessionId(v, headers, body);
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
    /** Keep Map iteration order in access order for the capped LRU eviction below. */
    assistantSessionStore.delete(hash);
    assistantSessionStore.set(hash, existing);
    return existing.sessionId;
  }
  if (assistantSessionStore.size >= MAX_ASSISTANT_SESSIONS) {
    assistantSessionStore.delete(assistantSessionStore.keys().next().value);
  }
  const sessionId = generateBinaryStyleId();
  assistantSessionStore.set(hash, { sessionId, lastUsed: Date.now() });
  return sessionId;
}

// Text parts reduce to their text, so a string and its single text part match and
// cache markers do not move the key. Other parts (images, files) keep their payload.
function anchorContent(content) {
  const parts = Array.isArray(content) ? content : [content];
  return parts.flatMap((part) => {
    const text = isString(part) ? part : part?.text;
    if (isString(text)) return text.trim() ? [text.trim()] : [];
    if (!part || !isObject(part)) return [];
    const { cache_control: _cacheControl, ...payload } = part;
    return [payload];
  });
}

/**
 * Stable key from the parts of a conversation that later turns replay unchanged:
 * system prompt and first user message (OmniRoute #21084). Returns null without
 * a user turn, since a system prompt alone is shared between conversations.
 */
function conversationAnchorSessionId(scope, body) {
  const input = isString(body?.input) ? [{ role: "user", content: body.input }] : body?.input;
  const items = Array.isArray(input) ? input : Array.isArray(body?.messages) ? body.messages : [];
  const userIndex = items.findIndex((item) => item?.role === "user");
  if (userIndex < 0) return null;
  const firstUser = anchorContent(items[userIndex].content);
  if (!firstUser.length) return null;
  const preamble = items.slice(0, userIndex).
  filter((item) => item?.role === "system" || item?.role === "developer").
  map((item) => anchorContent(item.content));
  const seed = JSON.stringify([scope, body.model ?? "", body.instructions ?? "", anchorContent(body.system ?? []), preamble, firstUser]);
  const hex = crypto.createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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
  // Codex keys its prompt cache on this id. Assistant text only exists from the
  // second turn, so first turns would otherwise share one account-wide key.
  if (scope === "codex") {
    const anchored = conversationAnchorSessionId(`${scope}:${connectionId || ""}`, body);
    if (anchored) return { sessionId: anchored, requestScoped: false };
  }
  const fromAssistant = assistantTextSessionId(`${scope}:${connectionId || ""}`, body);
  if (fromAssistant) return { sessionId: fromAssistant, requestScoped: false };
  const ws = normalizeSessionId(workspaceId);
  if (ws) return { sessionId: ws, requestScoped: false };
  return { sessionId: deriveSessionId(connectionId), requestScoped: true };
}

/**
 * Resolve a conversation-stable session id (generalizes Codex resolveCacheSessionId).
 * Priority: client session → (codex only) system + first-user anchor →
 * accumulated-assistant-text hash → workspaceId → per-connection.
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
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (assistantCleanup.unref) assistantCleanup.unref();
