import { isBrowser, isFunction, isRecord, isString } from "../../../../../shared/utils/typeChecks.js";
const CUSTOM_LAST_KEY = "durindoor.cliToolEndpointCustom";
/** Shared with BaseUrlSelect / EndpointPresetControl — never store raw secrets here. */
export const ENDPOINT_PRESETS_STORAGE_KEY = "durindoor.cliToolEndpointPresets";

/** Display both user label and endpoint when they differ. */
export function formatEndpointPresetLabel({ name, baseUrl }) {
  return name === baseUrl ? baseUrl : `${name} — ${baseUrl}`;
}

/** Read last manual endpoint without failing when storage is unavailable. */
export function readLastCustomUrl() {
  if (!isBrowser()) return "";
  try {return window.localStorage.getItem(CUSTOM_LAST_KEY) || "";} catch {return "";}
}

/** Persist last non-empty manual endpoint for later Custom URL selections. */
export function writeLastCustomUrl(url) {
  if (!isBrowser() || !url) return;
  try {window.localStorage.setItem(CUSTOM_LAST_KEY, url);} catch {/* storage unavailable */}
}

// Browser-local API key preset store shared by every CLI tool card's ApiKeySelect.
// Ported from upstream decolua/9router c24a8542 (generic createStore factory); the
// fork keeps endpoint presets inline in BaseUrlSelect/EndpointPresetControl, so the
// factory is instantiated here only for API keys, uses isBrowser() instead of
// runtime `typeof` (anti-slop gate), and the durindoor.* storage-key prefix.
function createPresetStore({ storageKey, changeEvent, itemField, normalize = (v) => v, defaultName = (v) => v }) {
  const read = () => {
    if (!isBrowser()) return [];
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.filter((p) => p?.name && p?.[itemField]);
    } catch {
      return [];
    }
  };

  const write = (items) => {
    if (!isBrowser()) return;
    // Browser policy, sandboxed contexts, or quota limits can make setItem
    // throw; degrade to a no-op so save/delete never breaks the dialog.
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      return;
    }
    window.dispatchEvent(new CustomEvent(changeEvent));
  };

  return {
    read,
    subscribe: (handler) => {
      if (!isBrowser()) return () => {};
      window.addEventListener(changeEvent, handler);
      return () => window.removeEventListener(changeEvent, handler);
    },
    // Adds or replaces a preset; returns the stored name, or null when skipped
    upsert: (value, name) => {
      const v = normalize(value);
      if (!v) return null;

      const items = read();
      const existing = items.find((p) => normalize(p[itemField]) === v);
      if (existing && !name) return existing.name;

      const finalName = (name || defaultName(v)).trim();
      if (!finalName) return null;

      const next = [...items.filter((p) => p.name !== finalName && normalize(p[itemField]) !== v), { name: finalName, [itemField]: v }]
        .sort((a, b) => a.name.localeCompare(b.name));
      write(next);
      return finalName;
    },
    remove: (name) => write(read().filter((p) => p.name !== name)),
  };
}

const apiKeyPresets = createPresetStore({
  storageKey: "durindoor.cliToolApiKeyPresets",
  changeEvent: "durindoor:api-key-presets-changed",
  itemField: "key",
});

export const readKeyPresets = apiKeyPresets.read;
export const subscribeKeyPresets = apiKeyPresets.subscribe;
export const upsertKeyPreset = apiKeyPresets.upsert;
export const deleteKeyPreset = apiKeyPresets.remove;

/** Mask a stored API key for display (never render a full saved secret). */
export function maskApiKey(apiKey) {
  if (!apiKey) return "";
  // Legacy sk-<8 hex> keys are only 11 chars; include the tail so two legacy
  // keys sharing their first hex digit don't collide on the default name.
  if (apiKey.length <= 12) return `${apiKey.slice(0, 4)}…${apiKey.slice(-2)}`;
  return `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`;
}

/** Display a saved key preset as "name (masked key)". */
export function formatKeyPresetLabel({ name, key }) {
  return `${name} (${maskApiKey(key)})`;
}

/**
 * Strip raw secrets from an endpoint preset. When `apiKey` matches a known
 * DurinDoor key (`knownKeys[].key`), keep `apiKeyId` + masked label; otherwise
 * drop the secret so the user re-enters it on apply.
 *
 * @param {unknown} preset
 * @param {Array<{ id?: string, key?: string, maskedKey?: string }>} [knownKeys]
 * @returns {{ name: string, baseUrl: string, apiKeyId?: string, maskedLabel?: string } | null}
 */
export function sanitizeEndpointPreset(preset, knownKeys = []) {
  if (!isRecord(preset)) return null;
  const name = isString(preset.name) ? preset.name.trim() : "";
  const baseUrl = isString(preset.baseUrl) ? preset.baseUrl.trim() : "";
  if (!name || !baseUrl) return null;

  const rawSecret = isString(preset.apiKey) ? preset.apiKey : "";
  let apiKeyId = isString(preset.apiKeyId) ? preset.apiKeyId.trim() : "";
  let maskedLabel = isString(preset.maskedLabel) ? preset.maskedLabel : "";

  if (rawSecret) {
    const match = (Array.isArray(knownKeys) ? knownKeys : []).find(
      (entry) => isRecord(entry) && isString(entry.id) && entry.id && isString(entry.key) && entry.key === rawSecret,
    );
    if (match) {
      apiKeyId = match.id;
      maskedLabel = (isString(match.maskedKey) && match.maskedKey) || maskApiKey(rawSecret);
    } else {
      // Non-DurinDoor (or unmatched) secret: never persist it.
      maskedLabel = maskedLabel || maskApiKey(rawSecret);
    }
  }

  const out = { name, baseUrl };
  if (apiKeyId) out.apiKeyId = apiKeyId;
  if (maskedLabel) out.maskedLabel = maskedLabel;
  return out;
}

/**
 * Build a storage-safe endpoint preset from the current form values.
 * @param {{ name?: string, baseUrl?: string, apiKey?: string }} fields
 * @param {Array<{ id?: string, key?: string, maskedKey?: string }>} [knownKeys]
 */
export function buildEndpointPreset(fields, knownKeys = []) {
  if (!isRecord(fields)) return null;
  return sanitizeEndpointPreset(
    { name: fields.name, baseUrl: fields.baseUrl, apiKey: fields.apiKey },
    knownKeys,
  );
}

/**
 * Migrate a raw localStorage list: strip every `apiKey`, attach `apiKeyId` when
 * the secret matches a known DurinDoor key.
 * @param {unknown} value
 * @param {Array<{ id?: string, key?: string, maskedKey?: string }>} [knownKeys]
 */
export function migrateEndpointPresets(value, knownKeys = []) {
  if (!Array.isArray(value)) return [];
  return value.map((preset) => sanitizeEndpointPreset(preset, knownKeys)).filter(Boolean);
}

/** Read endpoint presets, rewriting storage when legacy `apiKey` secrets are present. */
export function readEndpointPresets(knownKeys = []) {
  if (!isBrowser()) return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(ENDPOINT_PRESETS_STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const hadSecret = raw.some((preset) => isRecord(preset) && isString(preset.apiKey) && preset.apiKey);
    const migrated = migrateEndpointPresets(raw, knownKeys);
    if (hadSecret) writeEndpointPresets(migrated);
    return migrated;
  } catch {
    return [];
  }
}

/** Persist endpoint presets after sanitizing (never writes `apiKey`). */
export function writeEndpointPresets(presets) {
  if (!isBrowser()) return;
  const safe = migrateEndpointPresets(presets, []);
  try {
    window.localStorage.setItem(ENDPOINT_PRESETS_STORAGE_KEY, JSON.stringify(safe));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Resolve the secret for a saved endpoint preset via the dashboard reveal API.
 * Returns "" when the preset has no DurinDoor key id (caller should clear the field).
 * @param {{ apiKeyId?: string } | null | undefined} preset
 * @param {{ reveal?: (id: string) => Promise<string | null> }} [options]
 */
export async function resolveEndpointPresetSecret(preset, options = {}) {
  const apiKeyId = isRecord(preset) && isString(preset.apiKeyId) ? preset.apiKeyId : "";
  if (!apiKeyId) return "";
  const revealFn = isRecord(options) && isFunction(options.reveal) ? options.reveal : revealDurindoorApiKey;
  const secret = await revealFn(apiKeyId);
  return isString(secret) ? secret : "";
}

/** On-demand secret fetch used when applying a DurinDoor-backed endpoint preset. */
export async function revealDurindoorApiKey(apiKeyId) {
  if (!isString(apiKeyId) || !apiKeyId) return null;
  try {
    const res = await fetch(`/api/keys/${apiKeyId}/reveal`);
    if (!res.ok) return null;
    const body = await res.json();
    return isString(body?.key) ? body.key : null;
  } catch {
    return null;
  }
}

/**
 * Build a known-keys list with secrets for matching, revealing managed keys as needed.
 * Stops early once `secret` matches so save does not dump every key.
 * @param {string} secret
 * @param {Array<{ id?: string, key?: string, maskedKey?: string }>} apiKeys
 */
export async function knownKeysForSecretMatch(secret, apiKeys = []) {
  if (!isString(secret) || !secret) return [];
  const list = Array.isArray(apiKeys) ? apiKeys : [];
  const known = [];
  for (const entry of list) {
    if (!isRecord(entry) || !isString(entry.id) || !entry.id) continue;
    if (isString(entry.key) && entry.key) {
      known.push(entry);
      if (entry.key === secret) return known;
      continue;
    }
    const revealed = await revealDurindoorApiKey(entry.id);
    if (!isString(revealed) || !revealed) continue;
    const row = { id: entry.id, key: revealed, maskedKey: entry.maskedKey };
    known.push(row);
    if (revealed === secret) return known;
  }
  return known;
}
