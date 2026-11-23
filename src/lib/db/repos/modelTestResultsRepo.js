import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// Persisted last-test status per "connection|alias/modelId" key. Rows are
// validated by parseModelTestResults (src/shared/utils/modelTestResults.js)
// before they reach this repo.
const SCOPE = "modelTestResults";

export async function getModelTestResults() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const out = {};
  for (const row of rows) {
    const value = parseJson(row.value, null);
    if (value) out[row.key] = value;
  }
  return out;
}

/** @param {Array<[string, object]>} entries */
export async function saveModelTestResults(entries) {
  if (entries.length === 0) return;
  const db = await getAdapter();
  db.transaction(() => {
    for (const [key, value] of entries) {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [SCOPE, key, stringifyJson(value)]
      );
    }
  });
}

/** @param {string[]} keys */
export async function clearModelTestResults(keys) {
  if (keys.length === 0) return;
  const db = await getAdapter();
  db.transaction(() => {
    for (const key of keys) db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, key]);
  });
}
