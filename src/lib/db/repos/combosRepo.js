import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { validateComboInvariant } from "@/lib/combos/invariants.js";

// Extract the persisted invariant shape from a combo payload. Accepts the
// fields under `invariant` or as top-level `allowedProviders` /
// `allowedModelFamilies`. Returns null when no constraint is declared.
function normalizeInvariant(data) {
  const src =
    data.invariant && typeof data.invariant === "object" && !Array.isArray(data.invariant)
      ? data.invariant
      : data;
  const allowedProviders = Array.isArray(src.allowedProviders)
    ? src.allowedProviders.filter((v) => typeof v === "string")
    : [];
  const allowedModelFamilies = Array.isArray(src.allowedModelFamilies)
    ? src.allowedModelFamilies.filter((v) => typeof v === "string")
    : [];
  if (allowedProviders.length === 0 && allowedModelFamilies.length === 0) return null;
  return { allowedProviders, allowedModelFamilies };
}

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    invariant: row.invariant ? parseJson(row.invariant, null) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
// keeps exact-name semantics for duplicate and policy checks.
export async function getComboForModel(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ? COLLATE NOCASE`, [name]);
  return rowToCombo(row);
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const invariant = normalizeInvariant(data);
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    invariant,
    createdAt: now,
    updatedAt: now,
  };
  // Reject a violating combo before the write so nothing is persisted.
  validateComboInvariant({ ...combo, ...(invariant || {}) });
  db.run(
    `INSERT INTO combos(id, name, kind, models, invariant, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), invariant ? stringifyJson(invariant) : null, combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    // Re-derive the invariant from the merged combo (a caller may set or
    // replace it) and validate the merged targets before persisting.
    const invariant = normalizeInvariant(merged) || merged.invariant || null;
    merged.invariant = invariant;
    validateComboInvariant({ ...merged, ...(invariant || {}) });
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, invariant = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), invariant ? stringifyJson(invariant) : null, merged.updatedAt, id]
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
