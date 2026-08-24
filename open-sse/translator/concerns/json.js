import { isString } from "@/shared/utils/typeChecks.js"; // Safe JSON.parse: non-string passthrough; on parse error return caller-chosen `fallback`.
export function safeParseJSON(str, fallback) {
  if (!isString(str)) return str;
  try {return JSON.parse(str);} catch {return fallback;}
}