// Encrypted PG connection URL storage.
//
// The connection URL (with password) is stored inside the canonical
// settings row at `settings.postgresUrl`, encrypted with the same
// AES-256-GCM master key that `columnCrypto.encryptField` uses. The
// AAD is the literal name `postgres-url`, so the ciphertext cannot be
// replayed into another settings field.
//
// Why the settings row and not a separate `durindoor-secrets.json`
// file? The settings row is the single source of truth for runtime
// configuration: it is the same place the dashboard reads and writes
// the redacted connection info (host, port, database, user,
// sslmode, authSource). Adding the URL to the same row keeps
// everything in one place, makes the operator's mental model simpler,
// and removes the need for a separate `durindoor-secrets.json` file
// (and its associated `secretsFilePath`, `secretsRead`, `secretsWrite`
// functions).
//
// The env var `DURINDOOR_PG_URL` is still honoured as an override at
// boot time. Operators that prefer env-var-driven configuration can
// keep using it; the dashboard form is the supported path for
// interactive use.
//
// For backward compatibility with the v1 file-based layout, the
// resolver falls back to `DATA_DIR/durindoor-secrets.json` if neither
// the env var nor the settings row has a value. New writes go only
// to the settings row; the file is read-only legacy.
//
// This module is intentionally narrow:
//   - It only knows about the `postgres-url` key.
//   - It does not surface the secret via `getSettings()`. The
//     resolver returns the plaintext only on demand.

import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "@/lib/dataDir.js";
import {
  encryptField,
  decryptField,
  isEncryptedBlob,
} from "@/lib/crypto/columnCrypto.js";
import { isObject, isString } from "../../shared/utils/typeChecks.js";

// Public name of the encrypted field inside the settings row.
export const SETTINGS_FIELD = "postgresUrl";
export const AAD = "postgres-url";
export const POSTGRES_URL_KEY = "postgres-url";

// Legacy file name (v1 layout). Read-only after this module ships.
const SECRETS_BASENAME = "durindoor-secrets.json";
const SECRETS_FILE_MODE = 0o600;

/** Returns the absolute path to the legacy secrets file. */
export function secretsFilePath() {
  return path.join(getDataDir(), SECRETS_BASENAME);
}

// ─── Legacy file helpers (read-only) ─────────────────────────────────
function readLegacyFile() {
  const p = secretsFilePath();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return isObject(raw) ? raw : {};
  } catch {
    return {};
  }
}

/**
 * Read a secret from the legacy `durindoor-secrets.json` file. Returns
 * the plaintext or `null`. This is a read-only fallback for operators
 * that pre-date the v2 (settings-row) layout; new writes go only to
 * the settings row.
 */
export function secretsReadLegacy(key) {
  if (!isString(key) || !key) return null;
  const blob = readLegacyFile()[key];
  if (blob == null) return null;
  if (!isEncryptedBlob(blob)) return null;
  try {
    return decryptField(blob, key);
  } catch {
    return null;
  }
}

// ─── Settings row helpers (v2, the supported path) ────────────────

/**
 * Decrypt a settings-row blob into the plaintext URL. Returns `null`
 * when the blob is missing or fails to decrypt (master-key rotation,
 * tamper, etc.).
 */
export function decryptPostgresUrl(blob) {
  if (!isEncryptedBlob(blob)) return null;
  try {
    return decryptField(blob, AAD);
  } catch {
    return null;
  }
}

/**
 * Encrypt a URL for storage in the settings row. The returned object
 * is the canonical `{v, iv, ct}` envelope that `isEncryptedBlob`
 * recognises.
 */
export function encryptPostgresUrl(url) {
  if (!isString(url) || !url.length) {
    throw new Error("encryptPostgresUrl: url must be a non-empty string");
  }
  return encryptField(url, AAD);
}

/**
 * Read the encrypted URL from the settings row. Uses a transient
 * SQLite adapter (not the cached driver) so it does not trigger the
 * full driver init during the cutover pipeline. Returns the plaintext
 * or `null`. The function is async because the adapter is async.
 */
export async function readPostgresUrlFromSettings() {
  const path = await import("node:path");
  const { getDataDir } = await import("@/lib/dataDir.js");
  const { openSqliteAdapter } = await import("./driver.js");
  const { stringifyJson: _sj, parseJson: _pj } = await import("./helpers/jsonCol.js");
  void _sj; void _pj;
  const dataFile = path.default.join(getDataDir(), "db", "data.sqlite");
  const adapter = await openSqliteAdapter(dataFile);
  try {
    const row = await adapter.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return null;
    const settings = JSON.parse(row.data);
    return decryptPostgresUrl(settings[SETTINGS_FIELD]);
  } catch {
    return null;
  } finally {
    try { await adapter.close?.(); } catch { /* noop */ }
  }
}

/**
 * Persist a new URL to the settings row via a transient SQLite
 * adapter. The function is async because the adapter is async.
 * Pass `null` to remove the stored URL.
 */
export async function writePostgresUrlToSettings(url) {
  const path = await import("node:path");
  const { getDataDir } = await import("@/lib/dataDir.js");
  const { openSqliteAdapter } = await import("./driver.js");
  const dataFile = path.default.join(getDataDir(), "db", "data.sqlite");
  const adapter = await openSqliteAdapter(dataFile);
  try {
    let next;
    if (url == null) {
      next = { postgresUrl: null };
    } else {
      if (!isString(url) || !url.length) {
        throw new Error("writePostgresUrlToSettings: url must be a non-empty string or null");
      }
      next = { [SETTINGS_FIELD]: encryptPostgresUrl(url) };
    }
    await adapter.transaction(async () => {
      const row = await adapter.get(`SELECT data FROM settings WHERE id = 1`);
      const current = row ? JSON.parse(row.data) : {};
      const merged = { ...current, ...next };
      await adapter.run(
        `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        [JSON.stringify(merged)]
      );
    });
  } finally {
    try { await adapter.close?.(); } catch { /* noop */ }
  }
}

/**
 * Resolves the active PG connection URL. Precedence:
 *   1. `process.env.DURINDOOR_PG_URL` (always wins; documented
 *      override for operators that prefer env-var-driven config).
 *   2. `settings.postgresUrl` (encrypted blob; the supported path
 *      for dashboard-managed connections).
 *   3. Legacy `DATA_DIR/durindoor-secrets.json` file (read-only
 *      fallback for pre-v2 installs).
 *   4. `null` (not configured; the runtime falls back to SQLite).
 *
 * The resolver is the only sanctioned reader of the secret; the
 * settings API and the cutover pipeline both call it.
 */
export async function resolvePostgresSecret() {
  const fromEnv = process.env.DURINDOOR_PG_URL;
  if (isString(fromEnv) && fromEnv.length > 0) return fromEnv;
  const fromSettings = await readPostgresUrlFromSettings();
  if (isString(fromSettings) && fromSettings.length > 0) return fromSettings;
  return secretsReadLegacy(POSTGRES_URL_KEY);
}
