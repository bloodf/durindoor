import { classifyProviderDiagnostic } from "../providerDiagnostics.js";

const KEY_PREFIX = "durindoor:provider-test:";
const SUCCESS_MESSAGE = "Connection check passed.";
const STATUSES = new Set(["success", "failed", "skipped", "unavailable"]);

const FAILURE_PROBES = [
  [undefined, { skipped: true }],
  [undefined, { unavailable: true }],
  ["401 unauthorized", {}],
  ["429 quota", {}],
  ["404 not found", {}],
  ["socket closed", {}],
];

/** Every message this store may write; anything else read back is discarded. */
const SAFE_MESSAGES = new Set([
  SUCCESS_MESSAGE,
  ...FAILURE_PROBES.map(([text, flags]) => classifyProviderDiagnostic(text, flags).guidance),
]);

export const providerTestKey = (connectionId) => `${KEY_PREFIX}${connectionId}`;

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Reduce a live test outcome to a status and fixed guidance; raw upstream text is dropped here. */
export function toSafeTestResult({ state, error }) {
  if (!STATUSES.has(state)) return null;
  if (state === "success") return { status: state, message: SUCCESS_MESSAGE };
  const { guidance } = classifyProviderDiagnostic(error, {
    skipped: state === "skipped",
    unavailable: state === "unavailable",
  });
  return { status: state, message: guidance };
}

/** Persist one connection's last test result. Storage failures are ignored. */
export function saveProviderTestResult(connectionId, outcome, { storage = defaultStorage(), now = () => new Date() } = {}) {
  const safe = toSafeTestResult(outcome);
  if (!safe || !storage) return null;
  const record = { ...safe, testedAt: now().toISOString() };
  try {
    storage.setItem(providerTestKey(connectionId), JSON.stringify(record));
  } catch {
    return null;
  }
  return record;
}

function parseRecord(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value === null || Array.isArray(value) || !(value instanceof Object)) return null;
  const { status, message, testedAt } = value;
  if (!STATUSES.has(status) || !SAFE_MESSAGES.has(message)) return null;
  const stamp = Date.parse(testedAt);
  if (!Number.isFinite(stamp)) return null;
  return { status, message, testedAt: new Date(stamp).toISOString() };
}

/** Read one connection's persisted result, or null when absent, unreadable or unsafe. */
export function loadProviderTestResult(connectionId, { storage = defaultStorage() } = {}) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(providerTestKey(connectionId));
    return raw ? parseRecord(raw) : null;
  } catch {
    return null;
  }
}

/** Map of connection id to persisted result, for the connections that have one. */
export function loadProviderTestResults(connectionIds, options) {
  const entries = connectionIds
    .map((id) => [id, loadProviderTestResult(id, options)])
    .filter(([, record]) => record !== null);
  return Object.fromEntries(entries);
}
