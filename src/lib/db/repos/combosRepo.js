import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { validateComboInvariant } from "@/lib/combos/invariants.js";
import { QUOTA_WRITE_LOCK_SQL, QUOTA_WRITE_LOCK_SQL_PG } from "./quotaSql.js";

// Extract the persisted invariant shape from a combo payload. Accepts the
// fields under `invariant` or as top-level `allowedProviders` /
// `allowedModelFamilies`. Returns null when no constraint is declared.
import { isObject, isString } from "../../../shared/utils/typeChecks.js";
function normalizeInvariant(data) {
  const src =
  data.invariant && isObject(data.invariant) && !Array.isArray(data.invariant) ?
  data.invariant :
  data;
  const allowedProviders = Array.isArray(src.allowedProviders) ?
  src.allowedProviders.filter((v) => isString(v)) :
  [];
  const allowedModelFamilies = Array.isArray(src.allowedModelFamilies) ?
  src.allowedModelFamilies.filter((v) => isString(v)) :
  [];
  if (allowedProviders.length === 0 && allowedModelFamilies.length === 0) return null;
  return { allowedProviders, allowedModelFamilies };
}
export class ComboMemberError extends Error {}

// Serialize graph reads with all combo writers on shared database engines.
function lockComboGraph(db) {
  if (db.capabilities?.isPostgres) {
    if (!db.get(QUOTA_WRITE_LOCK_SQL_PG)) throw new Error("Combo storage is not initialized");
  } else if (db.run(QUOTA_WRITE_LOCK_SQL).changes !== 1) {
    throw new Error("Combo storage is not initialized");
  }
}

// Resolve names as routing does (exact first, then case-insensitive). Scan the
// whole graph because a rename can change resolution in another component.
function validateComboCycles(db, proposed) {
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC, id ASC`)
    .filter((row) => row.id !== proposed.id).map(rowToCombo);
  rows.push(proposed);
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const resolve = (name) => isString(name) && (rows.find((row) => row.name === name) ||
    rows.find((row) => row.name.toLowerCase() === name.toLowerCase()));
  const active = new Set();
  const done = new Set();
  function visit(combo) {
    if (active.has(combo.id)) throw new ComboMemberError("Combo cycle detected");
    if (done.has(combo.id)) return;
    active.add(combo.id);
    for (const model of combo.models) {
      const nested = resolve(model);
      if (nested) visit(nested);
    }
    active.delete(combo.id);
    done.add(combo.id);
  }
  for (const combo of rows) visit(combo);
}

// Members preserve established string `models` routing while carrying optional
// selection weights. Legacy rows read as weight 1; supplied weights are strict.
export function normalizeComboMembers(models, members) {
  const ids = Array.isArray(models) ? models : [];
  if (members === undefined || members === null) return ids.map((id) => ({ id, weight: 1 }));
  if (!Array.isArray(members) || members.length !== ids.length) throw new ComboMemberError("Combo members must match models");
  const saved = new Map();
  for (const member of members) {
    if (!member || !isString(member.id) || !Number.isFinite(member.weight) || member.weight < 0) {
      throw new ComboMemberError("Each combo member weight must be a positive finite number or zero");
    }
    const occurrences = saved.get(member.id) || [];
    occurrences.push(member.weight);
    saved.set(member.id, occurrences);
  }
  if (members.length && !members.some((member) => member.weight > 0)) throw new ComboMemberError("At least one combo member must have positive weight");
  const normalized = ids.map((id) => {
    const occurrences = saved.get(id);
    if (!occurrences?.length) throw new ComboMemberError("Combo members must match models");
    return { id, weight: occurrences.shift() };
  });
  if ([...saved.values()].some((occurrences) => occurrences.length)) throw new ComboMemberError("Combo members must match models");
  return normalized;
}

// A `models`-only patch (add/remove/reorder from the dashboard) must not silently
// reset weights to 1 for surviving members — only an explicit `members` payload
// (over)writes weights.
function mergeMembersOnModelsPatch(models, priorMembers) {
  const byId = new Map();
  for (const member of priorMembers || []) {
    const occurrences = byId.get(member.id) || [];
    occurrences.push(member.weight);
    byId.set(member.id, occurrences);
  }
  return models.map((id) => ({ id, weight: byId.get(id)?.shift() ?? 1 }));
}

// Empty / omitted allow-lists mean unrestricted. IDs are de-duplicated so the
// stored policy has one canonical shape and later relation filters can only
// intersect it, never replace it.
function normalizeAllowedConnectionIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => isString(id) && id.length > 0))];
}

// Steps removed by the opt-in auto-prune live in the kv store (one row per
// combo id) instead of a new column, so SQLite and PostgreSQL share the path and
// no migration is needed. Each record: { step, model, provider, prunedAt, reason, weight }.
const PRUNED_STEPS_SCOPE = "comboPrunedSteps";
const NO_LOG_SCOPE = "comboNoLog";

function withNoLog(db, row) {
  const combo = rowToCombo(row);
  if (!combo) return null;
  return { ...combo, noLog: !!db.get(`SELECT value FROM kv WHERE scope = ? AND key = ? AND value = ?`, [NO_LOG_SCOPE, combo.id, "true"]) };
}

function writeNoLog(db, id, noLog) {
  db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [NO_LOG_SCOPE, id]);
  if (noLog === true) db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)`, [NO_LOG_SCOPE, id, "true"]);
}

function normalizePrunedSteps(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isObject(entry) && isString(entry.model) && entry.model).map((entry) => ({
    step: Number.isInteger(entry.step) && entry.step >= 0 ? entry.step : 0,
    model: entry.model,
    provider: isString(entry.provider) ? entry.provider : null,
    prunedAt: isString(entry.prunedAt) ? entry.prunedAt : null,
    reason: isString(entry.reason) ? entry.reason : "",
    weight: Number.isFinite(entry.weight) && entry.weight >= 0 ? entry.weight : 1
  }));
}

function readPrunedSteps(db, comboId) {
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [PRUNED_STEPS_SCOPE, comboId]);
  return row ? normalizePrunedSteps(parseJson(row.value, [])) : [];
}

function writePrunedSteps(db, comboId, steps) {
  if (steps.length === 0) {
    db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [PRUNED_STEPS_SCOPE, comboId]);
    return;
  }
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [PRUNED_STEPS_SCOPE, comboId, stringifyJson(steps)]
  );
}

function rowToCombo(row) {
  if (!row) return null;
  const models = parseJson(row.models, []);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models,
    members: normalizeComboMembers(models, parseJson(row.members, null)),
    invariant: row.invariant ? parseJson(row.invariant, null) : null,
    capabilities: row.capabilities ? parseJson(row.capabilities, null) : null,
    allowedConnectionIds: normalizeAllowedConnectionIds(parseJson(row.allowedConnectionIds, [])),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export async function getCombos() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  const pruned = new Map(db.all(`SELECT key, value FROM kv WHERE scope = ?`, [PRUNED_STEPS_SCOPE])
    .map((entry) => [entry.key, normalizePrunedSteps(parseJson(entry.value, []))]));
  return rows.map((row) => ({ ...withNoLog(db, row), prunedSteps: pruned.get(row.id) || [] }));
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return row ? { ...withNoLog(db, row), prunedSteps: readPrunedSteps(db, id) } : null;
}

export async function getComboByName(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
  return withNoLog(db, row);
}

// Routing accepts user-entered combo names case-insensitively, but management
// keeps exact-name semantics for duplicate and policy checks. Exact matches win
// over case collisions; fallback order is stable across SQLite adapters.
export async function getComboForModel(name) {
  const db = await getAdapter();
  let row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
  if (!row) {
    row = db.get(
      `SELECT * FROM combos WHERE name = ? COLLATE NOCASE ORDER BY createdAt ASC, id ASC LIMIT 1`,
      [name]
    );
  }
  return withNoLog(db, row);
}

export async function createCombo(data) {
  if (Object.hasOwn(data, "models") && !Array.isArray(data.models)) {
    throw new ComboMemberError("Combo models must be an array");
  }
  const db = await getAdapter();
  const now = new Date().toISOString();
  const invariant = normalizeInvariant(data);
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    members: normalizeComboMembers(data.models || [], data.members),
    invariant,
    capabilities: data.capabilities || null,
    allowedConnectionIds: normalizeAllowedConnectionIds(data.allowedConnectionIds),
    prunedSteps: [],
    noLog: data.noLog === true,
    createdAt: now,
    updatedAt: now
  };
  // Reject a violating combo before the write so nothing is persisted.
  validateComboInvariant({ ...combo, ...(invariant || {}) });
  db.transaction(() => {
    lockComboGraph(db);
    validateComboCycles(db, combo);
    db.run(
      `INSERT INTO combos(id, name, kind, models, members, invariant, capabilities, allowedConnectionIds, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [combo.id, combo.name, combo.kind, stringifyJson(combo.models), stringifyJson(combo.members), invariant ? stringifyJson(invariant) : null, combo.capabilities ? stringifyJson(combo.capabilities) : null, stringifyJson(combo.allowedConnectionIds), combo.createdAt, combo.updatedAt]
    );
    writeNoLog(db, combo.id, combo.noLog);
  });
  return combo;
}

export async function updateCombo(id, data) {
  if (Object.hasOwn(data, "models") && !Array.isArray(data.models)) {
    throw new ComboMemberError("Combo models must be an array");
  }
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    lockComboGraph(db);
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    // prunedSteps is written only by pruneComboSteps / restorePrunedSteps.
    const merged = { ...withNoLog(db, row), ...data, prunedSteps: readPrunedSteps(db, id), updatedAt: new Date().toISOString() };
    const priorMembers = rowToCombo(row).members;
    merged.models = Array.isArray(data.models) ? data.models : merged.models;
    merged.members = data.members !== undefined ?
    normalizeComboMembers(merged.models, data.members) :
    Array.isArray(data.models) ?
    mergeMembersOnModelsPatch(merged.models, priorMembers) :
    priorMembers;
    merged.members = normalizeComboMembers(merged.models, merged.members);
    // Re-derive the invariant from the merged combo (a caller may set or
    // replace it) and validate the merged targets before persisting.
    const invariant = normalizeInvariant(merged) || merged.invariant || null;
    merged.invariant = invariant;
    merged.allowedConnectionIds = normalizeAllowedConnectionIds(merged.allowedConnectionIds);
    validateComboInvariant({ ...merged, ...(invariant || {}) });
    validateComboCycles(db, merged);
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, members = ?, invariant = ?, capabilities = ?, allowedConnectionIds = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), stringifyJson(merged.members), invariant ? stringifyJson(invariant) : null, merged.capabilities ? stringifyJson(merged.capabilities) : null, stringifyJson(merged.allowedConnectionIds), merged.updatedAt, id]
    );
    writeNoLog(db, id, merged.noLog);
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [PRUNED_STEPS_SCOPE, id]);
  db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [NO_LOG_SCOPE, id]);
  return (res?.changes ?? 0) > 0;
}

function persistSteps(db, row, models, members, now) {
  const combo = rowToCombo(row);
  const next = { ...combo, models, members: normalizeComboMembers(models, members), updatedAt: now };
  validateComboInvariant({ ...next, ...(combo.invariant || {}) });
  validateComboCycles(db, next);
  db.run(`UPDATE combos SET models = ?, members = ?, updatedAt = ? WHERE id = ?`, [stringifyJson(next.models), stringifyJson(next.members), now, row.id]);
  return next;
}

/**
 * Move stale steps off a combo and record them as prunedSteps. `stale` is
 * [{ model, provider }]. A combo is never left with zero steps: when every
 * step would go, nothing changes and `skipped` is "would-empty".
 * @returns {Promise<{ pruned: object[], skipped: null|"would-empty"|"not-found"|"none" }>}
 */
export async function pruneComboSteps(id, stale, { reason = "Model no longer in the provider's live catalog", now = new Date().toISOString() } = {}) {
  const db = await getAdapter();
  const providerByModel = new Map((Array.isArray(stale) ? stale : []).filter((s) => s && isString(s.model)).map((s) => [s.model, s.provider ?? null]));
  let outcome = { pruned: [], skipped: "not-found" };
  db.transaction(() => {
    lockComboGraph(db);
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const combo = rowToCombo(row);
    const doomed = combo.models.map((model, index) => providerByModel.has(model) ? index : -1).filter((index) => index >= 0);
    if (doomed.length === 0) { outcome = { pruned: [], skipped: "none" }; return; }
    if (doomed.length >= combo.models.length) { outcome = { pruned: [], skipped: "would-empty" }; return; }
    const keep = combo.members.filter((_, index) => !doomed.includes(index));
    // Pruning must not leave only zero-weight members.
    if (!keep.some((member) => member.weight > 0)) { outcome = { pruned: [], skipped: "would-empty" }; return; }
    const pruned = doomed.map((index) => ({
      step: index,
      model: combo.models[index],
      provider: providerByModel.get(combo.models[index]),
      prunedAt: now,
      reason,
      weight: combo.members[index].weight
    }));
    persistSteps(db, row, keep.map((member) => member.id), keep, now);
    writePrunedSteps(db, id, [...readPrunedSteps(db, id), ...pruned]);
    outcome = { pruned, skipped: null };
  });
  return outcome;
}

/**
 * Put pruned steps back at their original position (clamped). `models`
 * limits the restore to those model ids; omitted restores every record. A
 * step whose model is already on the combo is dropped from the record
 * without being added twice. Returns null when the combo does not exist.
 * @returns {Promise<{ combo: object, restored: object[] }|null>}
 */
export async function restorePrunedSteps(id, { models: only = null, now = new Date().toISOString() } = {}) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    lockComboGraph(db);
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const combo = rowToCombo(row);
    const records = readPrunedSteps(db, id);
    const wanted = Array.isArray(only) ? new Set(only) : null;
    const selected = records.filter((record) => !wanted || wanted.has(record.model)).sort((a, b) => a.step - b.step);
    const rest = records.filter((record) => !selected.includes(record));
    const models = [...combo.models];
    const members = [...combo.members];
    const restored = [];
    for (const record of selected) {
      if (models.includes(record.model)) continue;
      const at = Math.min(record.step, models.length);
      models.splice(at, 0, record.model);
      members.splice(at, 0, { id: record.model, weight: record.weight });
      restored.push(record);
    }
    const next = restored.length ? persistSteps(db, row, models, members, now) : combo;
    writePrunedSteps(db, id, rest);
    result = { combo: { ...next, prunedSteps: rest }, restored };
  });
  return result;
}
