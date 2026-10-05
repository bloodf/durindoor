import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const SCOPE = "sharedModelMetadata";
const KEY = "models.dev";

export async function getCachedSharedModelMetadata() {
  const db = await getAdapter();
  const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [SCOPE, KEY]);
  return row ? parseJson(row.value, null) : null;
}

export async function saveCachedSharedModelMetadata(snapshot) {
  const db = await getAdapter();
  db.run("INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value", [SCOPE, KEY, stringifyJson(snapshot)]);
}
