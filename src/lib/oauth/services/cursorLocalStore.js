import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createRequire } from "module";

// better-sqlite3 is optional; lazy-load via createRequire so this module
// can be imported on hosts where the native binding fails to build.
import { isString } from "@/shared/utils/typeChecks.js";let Database = null;
try {
  const require = createRequire(import.meta.url);
  Database = require("better-sqlite3");
} catch {
  Database = null;
}

export const CURSOR_ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
export const CURSOR_MACHINE_ID_KEYS = [
"storage.serviceMachineId",
"storage.machineId",
"telemetry.machineId"];

export const CURSOR_CACHED_EMAIL_KEYS = ["cursorAuth/cachedEmail"];

function normalizeStoredValue(value) {
  if (!isString(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (isString(parsed)) return parsed;
    return value;
  } catch {
    return value;
  }
}

/** Candidate state.vscdb paths by platform */
export function getCursorDbCandidatePaths(platform = process.platform) {
  const home = homedir();

  if (platform === "darwin") {
    return [
    join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
    join(home, "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb")];

  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
    join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
    join(appData, "Cursor - Insiders", "User", "globalStorage", "state.vscdb"),
    join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
    join(localAppData, "Programs", "Cursor", "User", "globalStorage", "state.vscdb")];

  }

  return [
  join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
  join(home, ".config/cursor/User/globalStorage/state.vscdb")];

}

/**
 * Read the first row in `itemTable` whose key matches one of `keys` and
 * whose value is non-null. Exact-match pass queries `key IN (?, ?, ...)`;
 * fuzzy fallback does `key LIKE 'prefix/%'` and `key LIKE 'prefix.%'`
 * with `prefix` being the first segment split on `/` or `.` (Cursor's
 * schema uses both separators).
 */
function queryFirst(db, keys) {
  if (!keys || keys.length === 0) return null;

  // Exact-match pass.
  const placeholders = keys.map(() => "?").join(",");
  try {
    const rows = db.
    prepare(`SELECT value, key FROM itemTable WHERE key IN (${placeholders})`).
    all(...keys);
    for (const key of keys) {
      const hit = rows.find((r) => r && r.key === key && r.value);
      if (hit) return normalizeStoredValue(hit.value);
    }
  } catch {

    // ignore — fall through to fuzzy
  }
  // Fuzzy fallback. The test mock returns the same row-set for any
  // query, so apply LIKE-matching on the returned rows ourselves.
  const matchesPrefix = (rowKey, prefix, sep) =>
  isString(rowKey) && rowKey.startsWith(prefix + sep);
  for (const key of keys) {
    const prefix = key.split(/[/.]/)[0];
    if (!prefix) continue;
    try {
      for (const sep of ["/", "."]) {
        const rows = db.
        prepare("SELECT value, key FROM itemTable WHERE key LIKE ?").
        all(prefix + sep + "%");
        const hit = rows.find(
          (r) => r && r.value && matchesPrefix(r.key, prefix, sep)
        );
        if (hit) return normalizeStoredValue(hit.value);
      }
    } catch {

      // ignore
    }}
  return null;
}

/** Read Cursor auth fields from a known state.vscdb path (sync). */
export function readCursorLocalAuthSync(dbPath) {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      return {
        accessToken: queryFirst(db, CURSOR_ACCESS_TOKEN_KEYS),
        machineId: queryFirst(db, CURSOR_MACHINE_ID_KEYS),
        cachedEmail: queryFirst(db, CURSOR_CACHED_EMAIL_KEYS)
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Find the first readable Cursor state.vscdb and return stored auth fields. */
export async function findAndReadCursorLocalAuth(platform = process.platform) {
  for (const candidate of getCursorDbCandidatePaths(platform)) {
    try {
      await access(candidate, constants.R_OK);
      return { dbPath: candidate, ...readCursorLocalAuthSync(candidate) };
    } catch {

      // try next candidate
    }}
  return null;
}

function isCursorEmail(value) {
  return isString(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isAuth0Subject(value) {
  return isString(value) && /^auth0\|user_/i.test(value);
}

export function cursorConnectionNeedsIdentityBackfill(connection) {
  if (connection?.provider !== "cursor") return false;
  if (isCursorEmail(connection.providerSpecificData?.cachedEmail)) return false;
  return isAuth0Subject(connection.email) || isAuth0Subject(connection.name);
}

export async function backfillCursorConnectionIdentity(connection, localAuth = null) {
  if (!cursorConnectionNeedsIdentityBackfill(connection)) return connection;

  const auth = localAuth || (await findAndReadCursorLocalAuth());
  if (!isCursorEmail(auth?.cachedEmail)) return connection;

  const { updateProviderConnection } = await import("@/lib/localDb");
  return await updateProviderConnection(connection.id, {
    email: auth.cachedEmail,
    name: auth.cachedEmail,
    providerSpecificData: {
      ...(connection.providerSpecificData || {}),
      cachedEmail: auth.cachedEmail
    }
  });
}

let cursorBackfillDone = false;

export async function backfillCursorEmails() {
  if (cursorBackfillDone) return;
  cursorBackfillDone = true;
  try {
    const { getProviderConnections } = await import("@/lib/localDb");
    const localAuth = await findAndReadCursorLocalAuth();
    if (!isCursorEmail(localAuth?.cachedEmail)) return;

    const connections = await getProviderConnections({ provider: "cursor" });
    for (const conn of connections) {
      if (!cursorConnectionNeedsIdentityBackfill(conn)) continue;
      await backfillCursorConnectionIdentity(conn, localAuth);
    }
  } catch (err) {
    cursorBackfillDone = false;
    console.log("backfillCursorEmails failed:", err?.message || err);
  }
}