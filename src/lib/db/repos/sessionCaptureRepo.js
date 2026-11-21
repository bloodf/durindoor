import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";
import { getSettingsSync } from "./settingsRepo.js";
import { isApiKeyExpired } from "../../../shared/utils/apiKeyExpiry.js";
import { isFunction, isRecord, isString } from "../../../shared/utils/typeChecks.js";
import { isSensitiveKey, redactValue } from "../../observability/redact.js";

export const CAPTURE_TURN_BYTES = 16 * 1024;
export const CAPTURE_KEY_BYTES = 1024 * 1024;
export const CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionId(value) {
  if (!isString(value) || !SESSION.test(value)) throw new Error("Invalid session ID");
  return value.toLowerCase();
}

function authenticate(db, credential, now) {
  if (!isString(credential) || !credential) throw new Error("Authentication required");
  const row = db.get('SELECT id, isActive, expiresAt FROM apiKeys WHERE key = ?', [credential]);
  if (!row || !(row.isActive === 1 || row.isActive === true) || isApiKeyExpired(row.expiresAt, now)) throw new Error("Authentication required");
  return row.id;
}

function safePayload(value, credential) {
  // Scrub the exact credential before pattern redaction can change part of it.
  const scrubText = (text) => redactValue(text.replaceAll(credential, "[redacted]"));
  const seen = new WeakSet();
  const scrub = (entry) => {
    if (isString(entry)) return scrubText(entry);
    const array = Array.isArray(entry);
    if (!array && !isRecord(entry)) return isFunction(entry) ? undefined : entry;
    if (seen.has(entry)) return "[circular]";
    seen.add(entry);
    const result = array ? entry.map(scrub) : Object.fromEntries(
      Object.entries(entry).map(([key, item]) => [
        scrubText(key),
        isSensitiveKey(key, item) || /password|secret|credential|private.?key/i.test(key)
          ? "[redacted]"
          : scrub(item),
      ])
    );
    seen.delete(entry);
    return result;
  };
  const json = JSON.stringify(scrub(value));
  if (!isString(json)) throw new Error("Invalid capture payload");
  return json;
}

/** Store one redacted turn only when operator and request both opt in. */
export async function captureSessionTurn({ credential, session, consent, turn, retentionMs = CAPTURE_MAX_AGE_MS }) {
  if (consent !== true) return false;
  const db = await getAdapter();
  if (getSettingsSync().enableSessionCapture !== true) return false;
  const sid = sessionId(session);
  if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0 || retentionMs > CAPTURE_MAX_AGE_MS) throw new Error("Invalid retention");
  const now = Date.now();
  const keyId = authenticate(db, credential, now);
  const content = safePayload(turn, credential);
  const size = Buffer.byteLength(content, "utf8");
  if (size > CAPTURE_TURN_BYTES) throw new Error("Capture turn exceeds limit");
  return db.transaction(() => {
    // The write locks the owner row on PostgreSQL and serializes SQLite writers.
    db.run('UPDATE apiKeys SET id = id WHERE id = ?', [keyId]);
    if (authenticate(db, credential, Date.now()) !== keyId) throw new Error("Authentication required");
    if (getSettingsSync().enableSessionCapture !== true) return false;
    db.run('DELETE FROM "sessionCaptureTurns" WHERE "expiresAt" <= ?', [new Date(now).toISOString()]);
    const used = db.get('SELECT COALESCE(SUM("byteSize"), 0) AS total FROM "sessionCaptureTurns" WHERE "apiKeyId" = ?', [keyId]);
    if (Number(used.total) + size > CAPTURE_KEY_BYTES) return false;
    db.run(
      `INSERT INTO "sessionCaptureTurns" ("id", "apiKeyId", "sessionId", "content", "byteSize", "createdAt", "expiresAt")
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), keyId, sid, content, size, new Date(now).toISOString(), new Date(now + retentionMs).toISOString()]
    );
    return true;
  });
}

/** Read at most 100 unexpired turns for one authenticated key and session. */
export async function readSessionTurns({ credential, session, limit = 100 }) {
  const sid = sessionId(session);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid limit");
  const db = await getAdapter();
  const now = Date.now();
  const keyId = authenticate(db, credential, now);
  return db.all(
    `SELECT "id", "content", "createdAt", "expiresAt" FROM "sessionCaptureTurns"
     WHERE "apiKeyId" = ? AND "sessionId" = ? AND "expiresAt" > ?
     ORDER BY "createdAt", "id" LIMIT ?`,
    [keyId, sid, new Date(now).toISOString(), limit]
  ).map((row) => ({ ...row, content: JSON.parse(row.content) }));
}

/** Delete only the authenticated key's turns for the supplied session. */
export async function deleteSessionTurns({ credential, session }) {
  const sid = sessionId(session);
  const db = await getAdapter();
  const keyId = authenticate(db, credential, Date.now());
  db.run('DELETE FROM "sessionCaptureTurns" WHERE "apiKeyId" = ? AND "sessionId" = ?', [keyId, sid]);
}

/** Remove expired capture rows; intended for operator maintenance. */
export async function pruneSessionTurns() {
  const db = await getAdapter();
  db.run('DELETE FROM "sessionCaptureTurns" WHERE "expiresAt" <= ?', [new Date().toISOString()]);
}
