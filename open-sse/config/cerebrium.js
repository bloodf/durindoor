import { isString } from "../../src/shared/utils/typeChecks.js";

// A deployment URL is an OpenAI base, not a shared Cerebrium service.
export function cerebriumBaseUrl(value) {
  if (!isString(value) || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (!url.pathname.endsWith("/run")) return null;
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}
