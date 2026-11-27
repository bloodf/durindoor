// SYNTX chat_uuid continuity. Port of OmniRoute c71f0065
// open-sse/services/syntxSessions.ts: OpenAI multi-turn history maps onto one
// SYNTX chat. A miss creates a chat; a follow-up reuses its uuid and sends
// only the new user turn or trailing tool results (SYNTX keeps prior turns).
//
// Fork deviation: the source kept module-global maps; here every map lives in
// one store created per executor, and every key carries the account
// fingerprint (auth.js), so accounts never share a chat.
import { createHash } from "node:crypto";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";

export const SYNTX_SESSION_MAX_AGE_MS = 6 * 3600_000;
/** First-turn client retries land within seconds; do not pin a pending uuid forever. */
export const SYNTX_SESSION_PENDING_MAX_AGE_MS = 3 * 60_000;
export const SYNTX_SESSION_MAX_ENTRIES = 300;
/** SYNTX chats cap near 800 messages. */
export const SYNTX_CHAT_MESSAGE_LIMIT = 800;
/** Force a new chat after this many successful generates on one uuid. */
export const SYNTX_CHAT_ROLLOVER_TURNS = 700;

const PINNED_TASK_MARKERS = ["My current task: ", "Current request: "];
const roleOf = (message) => (isString(message?.role) ? message.role.toLowerCase() : "");

export function canonicalizeSyntxUserText(text) {
  let t = (isString(text) ? text : "").trim();
  if (!t) return "";
  for (const marker of PINNED_TASK_MARKERS) {
    const idx = t.lastIndexOf(marker);
    if (idx >= 0) {
      t = t.slice(idx + marker.length).trim();
      break;
    }
  }
  return t.replace(/\s+/g, " ").trim();
}

function extractFromObject(content) {
  if (isString(content.text) && content.text) return content.text;
  if (isString(content.content) && content.content) return content.content;
  if (Array.isArray(content.content)) return extractSyntxMessageText(content.content);
  if (Array.isArray(content.parts)) return extractSyntxMessageText(content.parts);
  return "";
}

function extractFromPart(part) {
  if (isString(part)) return part;
  if (!isRecord(part)) return "";
  const type = isString(part.type) ? part.type.toLowerCase() : "";
  if (type === "tool_result" || type === "function_result") {
    return extractSyntxMessageText(part.content) || extractSyntxMessageText(part.output) || (isString(part.content) ? part.content : "");
  }
  if (isString(part.text) && part.text) return part.text;
  if (isString(part.content) && part.content) return part.content;
  return "";
}

/** Source extractSyntxMessageText: string, object, or part-array content -> text. */
export function extractSyntxMessageText(content) {
  if (isString(content)) return content;
  if (isRecord(content)) return extractFromObject(content);
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    const text = extractFromPart(part);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

export function conversationPrefixBeforeLastUser(messages) {
  if (!messages.length) return [];
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]) === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser <= 0) return [];
  return messages.slice(0, lastUser);
}

export function lastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) if (roleOf(messages[i]) === "user") return messages[i];
  return null;
}

export function hashSyntxConversation(fingerprint, model, messages) {
  const payload = messages.map((message) => {
    const role = roleOf(message);
    let text = extractSyntxMessageText(message.content);
    if (role === "user" || role === "human") text = canonicalizeSyntxUserText(text);
    return `${role}:${text}`;
  }).join("\n");
  return createHash("sha256").update(`${fingerprint}|${model}|${payload}`).digest("hex");
}

export function syntxUserSpine(messages) {
  const spine = [];
  for (const message of messages) {
    const role = roleOf(message);
    if (role !== "user" && role !== "human") continue;
    spine.push({ role: "user", content: canonicalizeSyntxUserText(extractSyntxMessageText(message.content)) });
  }
  return spine;
}

export function firstCanonicalSyntxUserText(messages) {
  const spine = syntxUserSpine(messages);
  return isString(spine[0]?.content) ? spine[0].content : "";
}

export function lastUserTextForReset(messages) {
  const last = lastUserMessage(messages);
  return last ? extractSyntxMessageText(last.content) : "";
}

/** Source looksLikeClaudeCodeSessionReset: a `/new` or `/clear` local-command envelope. */
export function looksLikeClaudeCodeSessionReset(text) {
  const t = (isString(text) ? text : "").trim();
  if (!t) return false;
  if (/<command-name>\s*\/(?:new|clear)\s*<\/command-name>/i.test(t)) return true;
  if (/<command-message>\s*(?:new|clear)\s*<\/command-message>/i.test(t)) return true;
  return t.includes("<local-command-caveat>") && /<\/command-name>/i.test(t) && /\/(?:new|clear)/i.test(t);
}

export function stripClaudeCodeLocalCommandEnvelope(text) {
  let t = isString(text) ? text : "";
  for (const tag of ["local-command-caveat", "command-name", "command-message", "command-args", "local-command-stdout", "local-command-stderr"]) {
    t = t.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "gi"), "");
  }
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function userHasToolResult(content) {
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    const type = isRecord(part) && isString(part.type) ? part.type.toLowerCase() : "";
    return type === "tool_result" || type === "function_result";
  });
}

export function isSyntxFollowUpHistory(messages) {
  for (const message of messages || []) {
    const role = roleOf(message);
    if (role === "assistant" || role === "model" || role === "tool" || role === "function") return true;
    if ((role === "user" || role === "human") && userHasToolResult(message.content)) return true;
  }
  return false;
}

/** After `/new` or `/clear`, session memory sees only the new first user turn. */
export function syntxMessagesForNewSession(messages) {
  const raw = lastUserTextForReset(messages);
  const stripped = stripClaudeCodeLocalCommandEnvelope(raw) || canonicalizeSyntxUserText(raw) || raw.trim();
  return [{ role: "user", content: stripped || "hi" }];
}

function evictOldest(map, max) {
  if (map.size <= max) return;
  let oldestKey = null;
  let oldestTs = Infinity;
  for (const [key, value] of map) {
    if (value.ts < oldestTs) {
      oldestTs = value.ts;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) map.delete(oldestKey);
}

/** One store per executor. Every method takes keys that already carry the account fingerprint. */
export function createSyntxSessionStore({ now = Date.now, maxEntries = SYNTX_SESSION_MAX_ENTRIES } = {}) {
  const sessions = new Map();
  const chatTools = new Map();
  const generateCounts = new Map();
  const posted = new Map();
  const createLocks = new Map();

  const lookup = (key) => {
    const entry = sessions.get(key);
    if (!entry) return null;
    const maxAge = entry.pending ? SYNTX_SESSION_PENDING_MAX_AGE_MS : SYNTX_SESSION_MAX_AGE_MS;
    if (now() - entry.ts > maxAge) {
      sessions.delete(key);
      return null;
    }
    return entry.chatUuid;
  };
  const remember = (key, chatUuid, pending = false) => {
    if (!key || !chatUuid) return;
    sessions.set(key, { chatUuid, ts: now(), pending: pending || undefined });
    evictOldest(sessions, maxEntries);
  };
  const hash = hashSyntxConversation;

  return {
    lookup,
    remember,
    /** Source lookupSyntxChatUuidForMessages. */
    lookupForMessages(fingerprint, model, messages) {
      if (looksLikeClaudeCodeSessionReset(lastUserTextForReset(messages))) return null;
      const exact = lookup(hash(fingerprint, model, messages));
      if (exact) return exact;
      if (!isSyntxFollowUpHistory(messages)) return null;
      const prefix = conversationPrefixBeforeLastUser(messages);
      if (prefix.length > 0) {
        const hit = lookup(hash(fingerprint, model, prefix));
        if (hit) return hit;
      }
      const spine = syntxUserSpine(messages);
      if (spine.length > 0) {
        const hit = lookup(hash(fingerprint, model, spine));
        if (hit) return hit;
      }
      if (spine.length > 1) {
        const hit = lookup(hash(fingerprint, model, spine.slice(0, -1)));
        if (hit) return hit;
      }
      const firstUser = firstCanonicalSyntxUserText(messages);
      if (firstUser) {
        const hit = lookup(hash(fingerprint, model, [{ role: "user", content: firstUser }]));
        if (hit) return hit;
      }
      return null;
    },
    /** Source lookupSyntxContinueChatUuid. */
    lookupContinue(fingerprint, model, firstUserText) {
      const first = canonicalizeSyntxUserText(firstUserText);
      if (!first) return null;
      return lookup(hash(fingerprint, model, [{ role: "user", content: first }]));
    },
    /** Source rememberSyntxPendingRequest. */
    rememberPending(fingerprint, model, messages, chatUuid) {
      if (!chatUuid || !messages?.length) return;
      remember(hash(fingerprint, model, messages), chatUuid, true);
      const first = firstCanonicalSyntxUserText(messages);
      if (first) remember(hash(fingerprint, model, [{ role: "user", content: first }]), chatUuid, true);
    },
    /** Source forgetSyntxPendingExact. */
    forgetPendingExact(fingerprint, model, messages) {
      const keys = [hash(fingerprint, model, messages)];
      const first = firstCanonicalSyntxUserText(messages);
      if (first) keys.push(hash(fingerprint, model, [{ role: "user", content: first }]));
      for (const key of keys) if (sessions.get(key)?.pending) sessions.delete(key);
    },
    markGeneratePosted(chatUuid) {
      if (!chatUuid) return;
      posted.set(chatUuid, { ts: now() });
      evictOldest(posted, maxEntries);
    },
    hasGeneratePosted(chatUuid) {
      const entry = chatUuid ? posted.get(chatUuid) : null;
      if (!entry) return false;
      if (now() - entry.ts > SYNTX_SESSION_MAX_AGE_MS) {
        posted.delete(chatUuid);
        return false;
      }
      return true;
    },
    /** Source coalesceSyntxChatCreate: concurrent first-turn retries share one create. */
    async coalesceCreate(key, factory) {
      if (!key) return factory();
      const existing = lookup(key);
      if (existing) return existing;
      const inflight = createLocks.get(key);
      if (inflight) return inflight;
      const pending = (async () => {
        try {
          const again = lookup(key);
          if (again) return again;
          const uuid = await factory();
          if (uuid) remember(key, uuid, true);
          return uuid;
        } finally {
          createLocks.delete(key);
        }
      })();
      createLocks.set(key, pending);
      return pending;
    },
    /** Source rememberSyntxFollowUp. */
    rememberFollowUp(fingerprint, model, messages, assistantText, chatUuid) {
      const prefix = conversationPrefixBeforeLastUser(messages);
      if (prefix.length > 0) remember(hash(fingerprint, model, prefix), chatUuid);
      const next = [
        ...messages.map((message) => ({ role: message.role, content: extractSyntxMessageText(message.content) })),
        { role: "assistant", content: assistantText },
      ];
      remember(hash(fingerprint, model, next), chatUuid);
      const spine = syntxUserSpine(messages);
      if (spine.length > 0) {
        remember(hash(fingerprint, model, spine), chatUuid);
        remember(hash(fingerprint, model, [spine[0]]), chatUuid);
      }
    },
    injectedToolsFingerprint(chatUuid) {
      const entry = chatUuid ? chatTools.get(chatUuid) : null;
      if (!entry) return null;
      if (now() - entry.ts > SYNTX_SESSION_MAX_AGE_MS) {
        chatTools.delete(chatUuid);
        return null;
      }
      return entry.fingerprint;
    },
    rememberInjectedTools(chatUuid, fingerprint) {
      if (!chatUuid || !fingerprint) return;
      chatTools.set(chatUuid, { fingerprint, ts: now() });
      evictOldest(chatTools, maxEntries);
    },
    noteGenerate(chatUuid) {
      if (!chatUuid) return 0;
      const next = { count: (generateCounts.get(chatUuid)?.count ?? 0) + 1, ts: now() };
      generateCounts.set(chatUuid, next);
      evictOldest(generateCounts, maxEntries);
      return next.count;
    },
    generateCount: (chatUuid) => (chatUuid ? generateCounts.get(chatUuid)?.count ?? 0 : 0),
    shouldRollover(chatUuid) {
      return (chatUuid ? generateCounts.get(chatUuid)?.count ?? 0 : 0) >= SYNTX_CHAT_ROLLOVER_TURNS;
    },
    setGenerateCountForTesting(chatUuid, count) {
      if (chatUuid) generateCounts.set(chatUuid, { count: Math.max(0, count), ts: now() });
    },
    clear() {
      sessions.clear();
      chatTools.clear();
      generateCounts.clear();
      posted.clear();
      createLocks.clear();
    },
  };
}
