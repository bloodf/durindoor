/**
 * V5 production switch (#1300).
 *
 * `DURINDOOR_UI_V5` is read from the environment at request time. It is an
 * environment variable rather than a setting so no settings key or
 * authorization allow-list changes. Server code calls `isUiV5Enabled()`;
 * client components call `useUiV5()`, which follows the `data-ui` attribute
 * that the root layout renders.
 *
 * This file carries no client directive: the root layout imports it on the
 * server. The hook lives in a client module and is only re-exported here.
 */

export { useUiV5 } from "./useUiV5.js";

export const UI_V5_ENV = "DURINDOOR_UI_V5";
export const UI_V5_ATTRIBUTE = "data-ui";
export const UI_V5_ATTRIBUTE_VALUE = "v5";
/** S20: V5 is the default. `DURINDOOR_UI_V5=0|false|off` restores the previous UI. */
export const UI_V5_DEFAULT = true;

const ON_VALUES = new Set(["1", "true", "on"]);
const OFF_VALUES = new Set(["0", "false", "off"]);

/** Resolve the switch. Unset or unrecognised values use the default. */
export function isUiV5Enabled(env = globalThis.process?.env ?? {}) {
  const value = String(env?.[UI_V5_ENV] ?? "").trim().toLowerCase();
  if (ON_VALUES.has(value)) return true;
  if (OFF_VALUES.has(value)) return false;
  return UI_V5_DEFAULT;
}

/** Root element attributes for the switch: `{ "data-ui": "v5" }` or `{}`. */
export function uiV5RootAttributes(env) {
  return isUiV5Enabled(env) ? { [UI_V5_ATTRIBUTE]: UI_V5_ATTRIBUTE_VALUE } : {};
}
