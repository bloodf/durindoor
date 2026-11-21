import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";
import { assertBillingEpochSync } from "./usageRepo.js";
import { getSettingsSync } from "./settingsRepo.js";
import { isApiKeyExpired } from "../../../shared/utils/apiKeyExpiry.js";
import { isFunction, isRecord, isString } from "../../../shared/utils/typeChecks.js";
import { isSensitiveKey, redactValue } from "../../observability/redact.js";

export const CAPTURE_TURN_BYTES = 16 * 1024;
export const CAPTURE_KEY_BYTES = 1024 * 1024;
export const CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeCaptureSessionId(value) {
  return isString(value) && SESSION.test(value) ? value.toLowerCase() : null;
}

function sessionId(value) {
  const normalized = normalizeCaptureSessionId(value);
  if (!normalized) throw new Error("Invalid session ID");
  return normalized;
}

function authenticate(db, credential, now) {
  if (!isString(credential) || !credential) throw new Error("Authentication required");
  const row = db.get('SELECT id, isActive, expiresAt FROM apiKeys WHERE key = ?', [credential]);
  if (!row || !(row.isActive === 1 || row.isActive === true) || isApiKeyExpired(row.expiresAt, now)) throw new Error("Authentication required");
  return row.id;
}

export function createCaptureTextRedactor(credentials) {
  const literals = [...credentials].sort((a, b) => b.length - a.length);
  const exact = new RegExp(literals.map((value) => RegExp.escape(value)).join("|"), "g");
  // Scrub exact credentials before pattern redaction can change part of one.
  return (text) => redactValue(text
    .replace(exact, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[redacted]")
    .replace(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g, "[redacted]"));
}

function redactCaptureTurn(value, credential) {
  const scrubText = createCaptureTextRedactor([credential]);
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
  if (sid === credential.toLowerCase() || keyId === credential) return false;
  const content = redactCaptureTurn(turn, credential);
  return insertTurn(db, { keyId, sid, content, now, retentionMs }, () => {
    if (authenticate(db, credential, Date.now()) !== keyId) throw new Error("Authentication required");
  });
}

/** Accept only pre-redacted content from the admitted chat observer. */
export async function storeAdmittedCapture({ keyId, session, content, billingEpoch }) {
  const db = await getAdapter();
  return insertTurn(db, {
    keyId, sid: sessionId(session), content, now: Date.now(), retentionMs: CAPTURE_MAX_AGE_MS,
  }, () => {
    const row = db.get('SELECT isActive, expiresAt FROM apiKeys WHERE id = ?', [keyId]);
    if (!row || !(row.isActive === 1 || row.isActive === true) || isApiKeyExpired(row.expiresAt, Date.now())) {
      throw new Error("Authentication required");
    }
  }, () => assertBillingEpochSync(db, billingEpoch));
}

function insertTurn(db, { keyId, sid, content, now, retentionMs }, verifyOwner, fence = () => {}) {
  const size = Buffer.byteLength(content, "utf8");
  if (size > CAPTURE_TURN_BYTES) throw new Error("Capture turn exceeds limit");
  return db.transaction(() => {
    fence();
    // The write locks the owner row on PostgreSQL and serializes SQLite writers.
    db.run('UPDATE apiKeys SET id = id WHERE id = ?', [keyId]);
    verifyOwner();
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

// Recheck credential ownership in the statement in case a concurrent key
// change follows the initial authentication on another database connection.
const OWNER = 'EXISTS (SELECT 1 FROM apiKeys WHERE id = ? AND key = ? AND isActive = 1)';

/**
 * Physically remove the expired rows that belong to one authenticated key.
 *
 * Reads filter expired rows out of the result set, so expired content stayed
 * on disk until a later write or operator maintenance. Pruning on read removes
 * it even when no further turn is written, and keeps the per-key byte quota
 * honest. The delete is scoped to the authenticated key: one key's read never
 * mutates another key's rows. Other keys' expired rows are removed by their
 * own reads, by a write, or by operator maintenance.
 */
function pruneExpiredTurns(db, keyId, cutoff, credential) {
  try {
    db.run('DELETE FROM "sessionCaptureTurns" WHERE "apiKeyId" = ? AND "expiresAt" <= ? AND ' + OWNER, [keyId, cutoff, keyId, credential]);
  } catch (error) {
    // Reads keep serving while a database cutover blocks writes. The expired
    // rows are removed by the next read, write or maintenance pass.
    if (error?.code !== "CUTOVER_IN_FLIGHT") throw error;
  }
}

/** Read at most 100 unexpired turns for one authenticated key and session. */
export async function readSessionTurns({ credential, session, limit = 100, expectedKeyId }) {
  const sid = sessionId(session);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid limit");
  const db = await getAdapter();
  const now = Date.now();
  const keyId = authenticate(db, credential, now);
  if (expectedKeyId !== undefined && expectedKeyId !== keyId) throw new Error("Authentication required");
  const cutoff = new Date(now).toISOString();
  pruneExpiredTurns(db, keyId, cutoff, credential);
  return db.all(
    `SELECT "id", "content", "createdAt", "expiresAt" FROM "sessionCaptureTurns"
     WHERE "apiKeyId" = ? AND "sessionId" = ? AND "expiresAt" > ? AND ${OWNER}
     ORDER BY "createdAt", "id" LIMIT ?`,
    [keyId, sid, cutoff, keyId, credential, limit]
  ).map((row) => ({ ...row, content: JSON.parse(row.content) }));
}

/** Delete only the authenticated key's turns for the supplied session. */
export async function deleteSessionTurns({ credential, session, expectedKeyId }) {
  const sid = sessionId(session);
  const db = await getAdapter();
  const keyId = authenticate(db, credential, Date.now());
  if (expectedKeyId !== undefined && expectedKeyId !== keyId) throw new Error("Authentication required");
  db.run('DELETE FROM "sessionCaptureTurns" WHERE "apiKeyId" = ? AND "sessionId" = ? AND ' + OWNER, [keyId, sid, keyId, credential]);
}

/**
 * Remove expired capture rows across every key; intended for operator
 * maintenance. Reads prune only the authenticated key's own expired rows.
 */
export async function pruneSessionTurns() {
  const db = await getAdapter();
  db.run('DELETE FROM "sessionCaptureTurns" WHERE "expiresAt" <= ?', [new Date().toISOString()]);
}
