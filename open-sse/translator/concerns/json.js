// Safe JSON.parse: non-string passthrough; on parse error return caller-chosen `fallback`.
import { isString } from "../../../src/shared/utils/typeChecks.js";
export function safeParseJSON(str, fallback) {
  if (!isString(str)) return str;
  try {return JSON.parse(str);} catch {return fallback;}
}