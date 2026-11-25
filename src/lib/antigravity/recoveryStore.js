import { decryptField, encryptField, masterKeyPresent } from "../crypto/columnCrypto.js";
import { getAdapter } from "../db/driver.js";
import { tableColumnNames } from "../db/helpers/tableColumns.js";
import { isString } from "../../shared/utils/typeChecks.js";

export const RECOVERY_AAD_PREFIX = "antigravity-recovery:v1:";
const FIELD = "recoveryPassword";

export function recoveryAad(connectionId) {
  return `${RECOVERY_AAD_PREFIX}${connectionId}:${FIELD}`;
}

function encryptionError() {
  const error = new Error("Antigravity recovery credential is unavailable");
  error.category = "encryption";
  return error;
}

function recoveryTableReady(db) {
  try {
    return tableColumnNames(db, "antigravityRecoveryCredentials").has("connectionId");
  } catch {
    return false;
  }
}

export function recoveryCredentialExists(db, connectionId) {
  if (!recoveryTableReady(db)) return false;
  return Boolean(db.get(`SELECT 1 AS present FROM antigravityRecoveryCredentials WHERE connectionId = ?`, [connectionId]));
}

export function writeRecoveryPassword(db, connectionId, password) {
  if (!isString(password) || password.length === 0) throw encryptionError();
  if (!recoveryTableReady(db)) throw encryptionError();
  if (recoveryCredentialExists(db, connectionId) && !masterKeyPresent()) throw encryptionError();
  const blob = encryptField(password, recoveryAad(connectionId), 2);
  const now = db.driver === "pg"
    ? "(CAST(EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS BIGINT))"
    : "(CAST(strftime('%s','now') AS INTEGER) * 1000)";
  db.run(
    `INSERT INTO antigravityRecoveryCredentials(connectionId, ciphertext, fieldName, updatedAt)
     VALUES (?, ?, ?, ${now})
     ON CONFLICT(connectionId) DO UPDATE SET ciphertext = excluded.ciphertext, fieldName = excluded.fieldName, updatedAt = excluded.updatedAt`,
    [connectionId, JSON.stringify(blob), FIELD]
  );
}

export function readRecoveryPassword(db, connectionId) {
  if (!recoveryTableReady(db)) return null;
  const row = db.get(`SELECT ciphertext FROM antigravityRecoveryCredentials WHERE connectionId = ?`, [connectionId]);
  if (!row) return null;
  if (!masterKeyPresent()) throw encryptionError();
  let blob;
  try {
    blob = JSON.parse(row.ciphertext);
  } catch {
    throw encryptionError();
  }
  return decryptField(blob, recoveryAad(connectionId));
}

export async function putRecoveryPassword(connectionId, password) {
  const db = await getAdapter();
  db.transaction(() => writeRecoveryPassword(db, connectionId, password));
}

export async function recoveryPasswordForJob(connectionId) {
  const db = await getAdapter();
  return readRecoveryPassword(db, connectionId);
}
