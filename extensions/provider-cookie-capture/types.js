/**
 * Runtime type predicates without the `typeof` operator, so the extension passes
 * the repository's anti-slop/no-runtime-typeof gate. Same technique as
 * `src/shared/utils/typeChecks.js`, copied because the extension ships on its own
 * and cannot import from the app.
 */

const tag = (value) => Object.prototype.toString.call(value);

/** A primitive string (a boxed String is not one). */
export const isString = (value) => tag(value) === "[object String]" && !(value instanceof String);

/** A primitive number, NaN and Infinity included. */
export const isNumber = (value) => tag(value) === "[object Number]" && !(value instanceof Number);

/** A plain object: not null, not an array. */
export const isRecord = (value) => tag(value) === "[object Object]";

/** Any non-null object, arrays included. */
export const isObjectLike = (value) => value !== null && Object(value) === value;
