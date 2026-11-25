import { get } from "./api.js";

/**
 * Shared read of the model alias map. Rejects like `api.get` and always reports
 * malformed JSON. Pass `skipErrorBody` to reject on the status alone.
 */
export async function readModelAliases(options) {
  const data = await get("/api/models/alias", { ...options, strictJson: true, defaultHeaders: false });
  return data.aliases || {};
}

/**
 * Apply the alias map, keeping the caller's current aliases on failure.
 * HTTP errors with a readable body stay silent; network and parse failures are logged.
 */
export async function loadModelAliases(apply, logLabel = "Error fetching model aliases:") {
  try {
    apply(await readModelAliases());
  } catch (error) {
    if (!error.status) console.log(logLabel, error);
  }
}
