import { isString } from "../../src/shared/utils/typeChecks.js";

export function readNamedHeader(headers, name) {
  if (!headers) return "";
  if (headers instanceof Headers) return headers.get(name)?.trim() || "";
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && isString(value) && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

