import { DEFAULT_SETTINGS_SCHEMA as DEFAULT_SETTINGS } from "../../lib/settings/settingsSchema.js";
import { isBoolean, isRecord, isString } from "./typeChecks.js";

// `caveman` is the stack text rewriter; `caveman-prompt` is only the injector.
export const COMPRESSION_ALIASES = Object.freeze({
  rtk: "rtkEnabled",
  headroom: "headroomEnabled",
  "caveman-prompt": "cavemanEnabled",
  pxpipe: "pxpipeEnabled",
});

/** Pure runtime view. Never migrates or materializes the stored engine map. */
export function resolveCompressionConfig(settings = {}) {
  const keys = [
    ...Object.values(COMPRESSION_ALIASES), "cavemanLevel", "compressionEnabled",
    "compressionFidelityGate", "compressionAdaptive", "headroomUrl",
    "headroomCompressUserMessages", "headroomTimeoutMs", "pxpipeMinChars",
    "pxpipeTimeoutMs", "pxpipeAllowedModels",
  ];
  const config = Object.fromEntries(keys.map((key) => [key, settings?.[key] ?? DEFAULT_SETTINGS[key]]));
  config.headroomUrl ||= DEFAULT_SETTINGS.headroomUrl;
  config.cavemanLevel ||= DEFAULT_SETTINGS.cavemanLevel;
  config.compressionEngines = isRecord(settings?.compressionEngines) ? settings.compressionEngines : DEFAULT_SETTINGS.compressionEngines;
  for (const id of ["rtk", "headroom"]) {
    const flat = COMPRESSION_ALIASES[id];
    config[flat] = config[flat] === true || (config.compressionEnabled === true && config.compressionEngines[id]?.enabled === true);
  }
  return config;
}

/** Mirror explicit alias writes only; a flat write never invents a map entry. */
export function mirrorCompressionPatch(current, updates) {
  const patch = { ...updates };
  const incoming = isRecord(updates?.compressionEngines) ? updates.compressionEngines : {};
  const stored = isRecord(current?.compressionEngines) ? current.compressionEngines : {};
  for (const [id, flat] of Object.entries(COMPRESSION_ALIASES)) {
    const entry = incoming[id];
    if (isBoolean(entry?.enabled)) {
      patch[flat] = entry.enabled; // Explicit map boolean wins a conflicting patch.
    } else if (isBoolean(updates?.[flat]) && entry !== null && (isRecord(entry) || isRecord(stored[id]))) {
      patch.compressionEngines = { ...(patch.compressionEngines ?? {}), [id]: { ...(entry ?? {}), enabled: updates[flat] } };
    }
  }
  const prompt = incoming["caveman-prompt"];
  if (isString(prompt?.level)) patch.cavemanLevel = prompt.level;
  else if (Object.hasOwn(updates, "cavemanLevel") && prompt !== null && (isRecord(prompt) || isRecord(stored["caveman-prompt"]))) {
    patch.compressionEngines = { ...(patch.compressionEngines ?? {}), "caveman-prompt": { ...(patch.compressionEngines?.["caveman-prompt"] ?? {}), level: updates.cavemanLevel } };
  }
  return patch;
}
