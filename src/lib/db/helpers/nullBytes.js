import { isString } from "../../../shared/utils/typeChecks.js";

/**
 * SQLite binds TEXT as a NUL-terminated C string, so a bound string that
 * contains an embedded NUL cannot survive the round trip:
 *
 *  - better-sqlite3 rejects it outright: "TypeError: String contains null byte"
 *  - node:sqlite accepts it and silently keeps only the prefix before the NUL
 *  - PostgreSQL TEXT rejects embedded NUL bytes
 *
 * Telemetry routinely carries values that can contain one — a model id or
 * endpoint taken straight from the request, raw bytes out of a tool result, a
 * diff, decompiled output. The first case aborts the write (and with it the
 * background flush worker), the second loses data with no trace at all.
 *
 * Stripping the NUL bytes keeps the text readable and the write alive. JSON
 * columns need no special handling: JSON.stringify escapes control characters,
 * so a serialised payload never carries a literal NUL. Credential and other
 * stored secrets are unchanged except that any embedded NUL is removed; the
 * rest of the secret value is byte-identical.
 *
 * Non-string values pass through untouched — numbers, null, undefined and
 * booleans are not text, and Buffers / TypedArrays are bound as BLOBs, which
 * have an explicit length and store binary fine. Caller inputs are never
 * mutated: dirty strings return a new string, clean strings and non-strings
 * return the same reference.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function stripNullBytes(value) {
  if (!isString(value)) return value;
  if (!value.includes("\0")) return value;
  return value.replace(/\0/g, "");
}

/**
 * Make every bound string NUL-safe, once, for all drivers.
 *
 * Sanitising at the binding boundary covers every SQLite and PostgreSQL
 * adapter and every column type with a single rule, instead of one call site
 * at a time. Only top-level array elements are rewritten; non-array `params`
 * pass through unchanged.
 *
 * @param {object} adapter
 * @returns {object} adapter with NUL-safe run/get/all
 */
export function withNullByteSafeParams(adapter) {
  if (!adapter || adapter.__nullByteSafe) return adapter;
  const clean = (params) => (Array.isArray(params) ? params.map(stripNullBytes) : params);
  return {
    ...adapter,
    __nullByteSafe: true,
    run: (sql, params = []) => adapter.run(sql, clean(params)),
    get: (sql, params = []) => adapter.get(sql, clean(params)),
    all: (sql, params = []) => adapter.all(sql, clean(params)),
  };
}
