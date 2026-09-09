import { isBrowser } from "../../../../../shared/utils/typeChecks.js";
const CUSTOM_LAST_KEY = "durindoor.cliToolEndpointCustom";

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
