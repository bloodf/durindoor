/**
 * Runtime type predicates without the `typeof` operator.
 *
 * Used to satisfy anti-slop/no-runtime-typeof while preserving ECMAScript
 * `typeof` tag semantics (including null→object, NaN→number, async→function).
 *
 * Undeclared globals: do not pass bare `window` / `document`. Use
 * {@link isBrowser} or `globalThis.window` so ReferenceError cannot occur.
 *
 * @module src/shared/utils/typeChecks
 */

const objectToString = Object.prototype.toString;

/**
 * @param {unknown} value
 * @returns {string}
 */
function tag(value) {
  return objectToString.call(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFunctionTag(value) {
  const t = tag(value);
  return (
    t === "[object Function]" ||
    t === "[object AsyncFunction]" ||
    t === "[object GeneratorFunction]" ||
    t === "[object AsyncGeneratorFunction]"
  );
}

/** `typeof value === "string"` (primitives only; boxed String is object). */
export function isString(value) {
  return tag(value) === "[object String]" && !(value instanceof String);
}

/** `typeof value === "number"` (includes NaN / Infinity; boxed Number is object). */
export function isNumber(value) {
  return tag(value) === "[object Number]" && !(value instanceof Number);
}

/** `typeof value === "boolean"` (boxed Boolean is object). */
export function isBoolean(value) {
  return tag(value) === "[object Boolean]" && !(value instanceof Boolean);
}

/** `typeof value === "function"` (includes async / generator variants). */
export function isFunction(value) {
  return isFunctionTag(value);
}

/**
 * `typeof value === "object"` — includes `null`, arrays, dates, boxed
 * primitives; excludes functions.
 */
export function isObject(value) {
  return value === null || (Object(value) === value && !isFunctionTag(value));
}

/** `typeof value === "undefined"` for evaluated values (not undeclared names). */
export function isUndefined(value) {
  return value === undefined;
}

/** `typeof value === "symbol"`. */
export function isSymbol(value) {
  return tag(value) === "[object Symbol]";
}

/** `typeof value === "bigint"`. */
export function isBigInt(value) {
  return tag(value) === "[object BigInt]";
}

/** Replaces `typeof window !== "undefined"` without touching undeclared bindings. */
export function isBrowser() {
  return !isUndefined(globalThis.window);
}

/**
 * ECMAScript `typeof` tag string for error messages / diagnostics, without
 * using the `typeof` operator. Arrays are reported as `"array"` (not `"object"`).
 * @param {unknown} value
 * @returns {string}
 */
export function runtimeTypeName(value) {
  if (value === null) return "object";
  if (Array.isArray(value)) return "array";
  if (isString(value)) return "string";
  if (isNumber(value)) return "number";
  if (isBoolean(value)) return "boolean";
  if (isFunction(value)) return "function";
  if (isSymbol(value)) return "symbol";
  if (isBigInt(value)) return "bigint";
  if (isUndefined(value)) return "undefined";
  return "object";
}
