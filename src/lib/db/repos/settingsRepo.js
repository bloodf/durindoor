import { getAdapter, getAdapterSync } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { DEFAULT_SETTINGS_SCHEMA as DEFAULT_SETTINGS, DEFAULT_QUOTA_TRACKER_STATE, SETTINGS_SCHEMA } from "../../settings/settingsSchema.js";
import { isBoolean, isFunction, isRecord, isString } from "../../../shared/utils/typeChecks.js";

// The imported defaults include the OIDC allowlists: oidcAllowedSubjects: [], oidcAllowedEmails: [], oidcAllowedDomains: [].

function migrateObservabilityKeys(raw) {
  const next = { ...(raw || {}) };
  const hasCanonical = Object.prototype.hasOwnProperty.call(next, "enableObservability");
  const hasLegacy = Object.prototype.hasOwnProperty.call(next, "enableObservability2");
  if (!hasCanonical && hasLegacy && isBoolean(next.enableObservability2)) {
    next.enableObservability = next.enableObservability2;
  }
  delete next.enableObservability2;
  return next;
}

/**
 * Merge a partial `compressionEngines` write over the stored toggle map.
 *
 * The compression stack is configured by one per-engine map
 * ({ [engineId]: { enabled, level?, ...engine options } }) stored in a single
 * settings field. A write that carries only the engine it changed used to
 * replace that whole map, so a toggle on one surface silently dropped every
 * sibling engine -- and every sibling's options -- the writer had not loaded.
 * OmniRoute #15613 fixes the same loss in the upstream compression store;
 * this is the fork's equivalent, applied to the fork's own settings field.
 *
 * Merge rules:
 *   - engines the write does not mention are kept exactly as stored;
 *   - an engine the write does mention is merged field by field, so a write
 *     that only flips `enabled` keeps the stored `level` and the stored
 *     per-engine options (lite's truncateToolResults / maxToolLength);
 *   - an explicit `null` engine removes that engine; a null property is stored.
 *
 * New engine IDs can be added; dispatch still gates unavailable catalog engines
 * on isEngineAvailable().
 *
 * @param {unknown} stored the currently stored `compressionEngines` value
 * @param {unknown} incoming the incoming `compressionEngines` value
 * @returns {Record<string, unknown>} the merged map
 */
export function mergeCompressionEngines(stored, incoming) {
  const base = isRecord(stored) ? stored : {};
  // A non-map write carries no engine information: keep what is stored
  // instead of replacing the map with something unreadable.
  if (!isRecord(incoming)) return { ...base };
  const merged = { ...base };
  for (const [id, entry] of Object.entries(incoming)) {
    if (entry === null) {
      delete merged[id];
      continue;
    }
    const baseEntry = isRecord(base[id]) ? base[id] : {};
    merged[id] = isRecord(entry) ? { ...baseEntry, ...entry } : entry;
  }
  return merged;
}

/**
 * Apply the compression-engines merge to a settings patch. Only a patch that
 * actually carries `compressionEngines` is touched; every other key keeps the
 * plain top-level replace semantics.
 */
function mergeObjectPatch(stored, incoming) {
  if (!isRecord(incoming)) return incoming;
  const merged = isRecord(stored) ? { ...stored } : {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null) {
      delete merged[key];
    } else if (isRecord(value)) {
      merged[key] = mergeObjectPatch(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export function mergeSettingsPatch(current, updates) {
  const merged = { ...updates };
  for (const [key, rule] of Object.entries(SETTINGS_SCHEMA)) {
    if (!Object.prototype.hasOwnProperty.call(updates, key) || rule.merge !== "keys") continue;
    merged[key] = key === "compressionEngines"
      ? mergeCompressionEngines(current?.[key], updates[key])
      : mergeObjectPatch(current?.[key], updates[key]);
  }
  return merged;
}

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  const parsed = row ? parseJson(row.data, {}) : {};
  const migrated = migrateObservabilityKeys(parsed);
  if (Object.prototype.hasOwnProperty.call(parsed, "enableObservability2")) {
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(migrated)]
    );
  }
  return migrated;
}


function readRawSync() {
  const db = getAdapterSync();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  const parsed = row ? parseJson(row.data, {}) : {};
  const migrated = migrateObservabilityKeys(parsed);
  if (Object.prototype.hasOwnProperty.call(parsed, "enableObservability2")) {
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(migrated)]
    );
  }
  return migrated;
}

export function getSettingsSync() {
  return mergeWithDefaults(readRawSync());
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  merged.quotaTrackerState = {
    ...DEFAULT_QUOTA_TRACKER_STATE,
    ...((raw || {}).quotaTrackerState || {})
  };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] !== undefined) continue;
    if (
    key === "outboundProxyEnabled" && isString(
      merged.outboundProxyUrl) &&
    merged.outboundProxyUrl.trim())
    {
      merged[key] = true;
    } else {
      merged[key] = defVal;
    }
  }
  return merged;
}

export async function getSettings() {
  const raw = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates).
// `updates` may be a function of the stored settings, for merges into a nested
// key that must see the row as it is inside the transaction.
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = migrateObservabilityKeys(row ? parseJson(row.data, {}) : {});
    const resolved = isFunction(updates) ? updates(current) : updates;
    const { enableObservability2: _legacyObservability, ...sanitizedUpdates } = resolved;
    next = migrateObservabilityKeys({
      ...current,
      ...mergeSettingsPatch(current, sanitizedUpdates),
    });
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
  return mergeWithDefaults(next);
}
export class PasswordEpochMismatchError extends Error {
  constructor() {
    super("password session epoch changed");
    this.code = "PASSWORD_EPOCH_MISMATCH";
  }
}

// Atomic CAS write for password mutations. Re-reads the row inside the
// same transaction; if the row's passwordSessionEpoch no longer matches
// `expectedEpoch`, the merge is aborted and the caller must retry instead
// of clobbering a concurrent rotation.
export async function updateSettingsWithPasswordEpoch(updates, expectedEpoch) {
  const { enableObservability2: _legacyObservability, ...sanitizedUpdates } = updates;
  const db = await getAdapter();
  let next;
  let matched = false;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = migrateObservabilityKeys(row ? parseJson(row.data, {}) : {});
    if ((current.passwordSessionEpoch ?? "initial") !== expectedEpoch) {
      matched = false;
      return;
    }
    matched = true;
    next = migrateObservabilityKeys({
      ...current,
      ...mergeSettingsPatch(current, sanitizedUpdates),
    });
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
  if (!matched) throw new PasswordEpochMismatchError();
  return mergeWithDefaults(next);
}

/**
 * Atomically match a candidate MFA backup code against the currently stored
 * hashes and, on a match, remove only that one hash -- read, match, and write
 * inside a single transaction (decolua/9router#4144 TOCTOU fix).
 *
 * The naive version (getSettings, then an async bcrypt.compare loop, then
 * updateSettings) reads the array before the compare loop's await points and
 * writes after them, so two concurrent verifications can both match the same
 * pre-write array and each independently persist their own "minus one hash"
 * result -- the loser's write clobbers the winner's, and the consumed code
 * is still valid. Reading fresh state inside the same transaction that
 * performs the write closes that window.
 *
 * `matchFn` MUST be synchronous (see backupCodes.js `findBackupCodeHashIndexSync`):
 * an `await` inside the transaction body would reopen exactly this race.
 *
 * @param {string} candidate raw user input, not yet normalized
 * @param {(candidate: string, hashes: string[]) => number} matchFn returns the matching index, or -1
 * @returns {Promise<{ matched: boolean, backupCodesRemaining: number }>}
 */
export async function consumeBackupCodeAtomic(candidate, matchFn) {
  const db = await getAdapter();
  let result = { matched: false, backupCodesRemaining: 0 };
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = migrateObservabilityKeys(row ? parseJson(row.data, {}) : {});
    const hashes = Array.isArray(current.mfaBackupCodes) ? current.mfaBackupCodes : [];
    const index = matchFn(candidate, hashes);
    if (index === -1) {
      result = { matched: false, backupCodesRemaining: hashes.length };
      return;
    }
    const remaining = hashes.slice(0, index).concat(hashes.slice(index + 1));
    const next = migrateObservabilityKeys({ ...current, mfaBackupCodes: remaining });
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
    result = { matched: true, backupCodesRemaining: remaining.length };
  });
  return result;
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    "");

}

export async function exportSettings() {
  return await readRaw();
}
