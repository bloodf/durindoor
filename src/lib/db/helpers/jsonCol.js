import { isString } from "../../../shared/utils/typeChecks.js";export function parseJson(str, fallback = null) {
  if (str == null) return fallback;
  if (!isString(str)) return str;
  try {return JSON.parse(str);} catch {return fallback;}
}

export function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}