import { isRecord, isString } from "./typeChecks.js";

// Persisted last-test status for routed models. A result belongs to one routed
// model ("alias/modelId") probed through one connection, so two accounts of the
// same provider never overwrite each other's status.
export const MODEL_TEST_STATES = ["ok", "error", "skipped"];
export const MAX_MODEL_TEST_RESULTS = 500;
const AUTO_CONNECTION = "auto";
const MAX_KEY_LENGTH = 512;
const MAX_ERROR_LENGTH = 500;

/** Storage key for one model probed through one connection (or the default route). */
export function modelTestResultKey(fullModel, connectionId) {
  const connection = isString(connectionId) && connectionId.trim() ? connectionId.trim() : AUTO_CONNECTION;
  return `${connection}|${fullModel}`;
}

function isValidKey(key) {
  if (!isString(key) || key.length > MAX_KEY_LENGTH) return false;
  const sep = key.indexOf("|");
  return sep > 0 && key.slice(sep + 1).includes("/");
}

/**
 * Parse a client payload into storable rows. Unknown keys, unknown states and
 * oversized batches are rejected, so callers can only write status records.
 *
 * @param {unknown} results
 * @returns {{ok: true, entries: Array<[string, {state: string, error: string|null, testedAt: string}]>} | {ok: false, error: string}}
 */
export function parseModelTestResults(results, now = new Date().toISOString()) {
  if (!isRecord(results)) return { ok: false, error: "results object required" };
  const raw = Object.entries(results);
  if (raw.length > MAX_MODEL_TEST_RESULTS) return { ok: false, error: `max ${MAX_MODEL_TEST_RESULTS} results per request` };
  const entries = [];
  for (const [key, value] of raw) {
    if (!isValidKey(key)) return { ok: false, error: `invalid result key: ${key.slice(0, 80)}` };
    if (!isRecord(value) || !MODEL_TEST_STATES.includes(value.state)) {
      return { ok: false, error: `invalid state for ${key.slice(0, 80)}` };
    }
    const error = value.state === "error" && isString(value.error) ? value.error.slice(0, MAX_ERROR_LENGTH) : null;
    entries.push([key, { state: value.state, error, testedAt: now }]);
  }
  return { ok: true, entries };
}

/** Parse a list of keys to clear. */
export function parseModelTestResultKeys(keys) {
  if (!Array.isArray(keys)) return { ok: false, error: "models[] required" };
  if (keys.length > MAX_MODEL_TEST_RESULTS) return { ok: false, error: `max ${MAX_MODEL_TEST_RESULTS} keys per request` };
  if (!keys.every(isValidKey)) return { ok: false, error: "invalid result key" };
  return { ok: true, keys };
}

/** Results for one connection, re-keyed by routed model ("alias/modelId"). */
export function selectConnectionResults(stored, connectionId) {
  const prefix = modelTestResultKey("", connectionId);
  const out = {};
  if (!isRecord(stored)) return out;
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith(prefix) && isRecord(value) && MODEL_TEST_STATES.includes(value.state)) {
      out[key.slice(prefix.length)] = value;
    }
  }
  return out;
}

/**
 * Collect batch probe results for persistence. Once the run's signal aborts,
 * later stream events are dropped, so a cancelled run never writes status for
 * models it did not finish before the user pressed Stop.
 *
 * @param {AbortSignal} signal
 * @param {string|undefined} connectionId
 */
export function createBatchResultCollector(signal, connectionId) {
  const collected = {};
  return {
    accept(fullModel, state, error) {
      if (signal.aborted || !MODEL_TEST_STATES.includes(state)) return false;
      collected[modelTestResultKey(fullModel, connectionId)] = { state, error: state === "error" ? error || null : null };
      return true;
    },
    results() {
      return { ...collected };
    },
  };
}

/** Fire-and-forget upsert from the dashboard; the UI never blocks on persistence. */
export function persistModelTestResults(results) {
  if (!isRecord(results) || Object.keys(results).length === 0) return;
  fetch("/api/models/test-results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results }),
  }).catch(() => {});
}

/** Load persisted results for one connection, keyed by routed model. */
export async function loadModelTestResults(connectionId) {
  try {
    const res = await fetch("/api/models/test-results", { cache: "no-store" });
    if (!res.ok) return {};
    const data = await res.json();
    return selectConnectionResults(data.results, connectionId);
  } catch {
    return {};
  }
}
