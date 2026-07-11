import { createHash } from "node:crypto";

/**
 * Build a deterministic, domain-separated key for in-memory caches without
 * retaining credentials or other caller-controlled values in Map keys.
 * Length-prefixing each part prevents ambiguous concatenations.
 *
 * @param {string} namespace Cache-specific domain separator.
 * @param {...unknown} parts Values that identify one cache entry.
 * @returns {string} SHA-256 cache key containing no raw input values.
 */
export function digestMemoryKey(namespace, ...parts) {
  const hash = createHash("sha256");
  for (const part of [namespace, ...parts]) {
    const value = part === undefined || part === null ? "" : String(part);
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update(":");
    hash.update(value);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
