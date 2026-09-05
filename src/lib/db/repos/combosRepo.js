import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { validateComboInvariant } from "@/lib/combos/invariants.js";

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

// Members preserve established string `models` routing while carrying optional
// selection weights. Legacy rows read as weight 1; supplied weights are strict.
export function normalizeComboMembers(models, members) {
  const ids = Array.isArray(models) ? models : [];
  if (members === undefined || members === null) return ids.map((id) => ({ id, weight: 1 }));
  if (!Array.isArray(members) || members.length !== ids.length) throw new ComboMemberError("Combo members must match models");
  const saved = new Map();
  for (const member of members) {
    if (!member || !isString(member.id) || !Number.isFinite(member.weight) || member.weight <= 0) {
      throw new ComboMemberError("Each combo member weight must be a positive finite number");
    }
    const occurrences = saved.get(member.id) || [];
    occurrences.push(member.weight);
    saved.set(member.id, occurrences);
  }
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export async function getCombos() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
  return rowToCombo(row);
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
  return rowToCombo(row);
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
    createdAt: now,
    updatedAt: now
  };
  // Reject a violating combo before the write so nothing is persisted.
  validateComboInvariant({ ...combo, ...(invariant || {}) });
  db.run(
    `INSERT INTO combos(id, name, kind, models, members, invariant, capabilities, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), stringifyJson(combo.members), invariant ? stringifyJson(invariant) : null, combo.capabilities ? stringifyJson(combo.capabilities) : null, combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  if (Object.hasOwn(data, "models") && !Array.isArray(data.models)) {
    throw new ComboMemberError("Combo models must be an array");
  }
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    const priorMembers = rowToCombo(row).members;
    merged.models = Array.isArray(data.models) ? data.models : merged.models;
    merged.members = data.members !== undefined ?
    normalizeComboMembers(merged.models, data.members) :
    Array.isArray(data.models) ?
    mergeMembersOnModelsPatch(merged.models, priorMembers) :
    priorMembers;
    // Re-derive the invariant from the merged combo (a caller may set or
    // replace it) and validate the merged targets before persisting.
    const invariant = normalizeInvariant(merged) || merged.invariant || null;
    merged.invariant = invariant;
    validateComboInvariant({ ...merged, ...(invariant || {}) });
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, members = ?, invariant = ?, capabilities = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), stringifyJson(merged.members), invariant ? stringifyJson(invariant) : null, merged.capabilities ? stringifyJson(merged.capabilities) : null, merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}