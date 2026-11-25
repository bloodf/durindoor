/** Selector value meaning "no per-combo override; follow the global strategy". */
export const INHERIT_COMBO_STRATEGY = "inherit";

/**
 * Apply a per-combo patch to `settings.comboStrategies` and return a new map.
 *
 * The settings store merges this map key by key: an omitted key keeps its stored
 * value, and only `null` deletes one. Removals are therefore written as `null`.
 * `fallback` is a real override (the global strategy may differ), so it is
 * stored; only `inherit` clears the strategy. An entry with no remaining
 * setting is removed; an explicit zero timeout remains a setting.
 */
export function updateComboStrategy(strategies, comboName, patch) {
  const entry = { ...strategies[comboName], ...patch };
  if (entry.fallbackStrategy === INHERIT_COMBO_STRATEGY) entry.fallbackStrategy = null;
  return { ...strategies, [comboName]: Object.values(entry).some((value) => value !== null && value !== undefined) ? entry : null };
}
