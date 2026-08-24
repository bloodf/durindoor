/**
 * CJS mirror of typeChecks.js for .cjs entrypoints (head-response-guard, etc.).
 * Keep in sync with typeChecks.js — no `typeof` operator.
 */
"use strict";

const objectToString = Object.prototype.toString;

function tag(value) {
  return objectToString.call(value);
}

function isFunctionTag(value) {
  const t = tag(value);
  return (
    t === "[object Function]" ||
    t === "[object AsyncFunction]" ||
    t === "[object GeneratorFunction]" ||
    t === "[object AsyncGeneratorFunction]"
  );
}

function isString(value) {
  return tag(value) === "[object String]" && !(value instanceof String);
}

function isNumber(value) {
  return tag(value) === "[object Number]" && !(value instanceof Number);
}

function isBoolean(value) {
  return tag(value) === "[object Boolean]" && !(value instanceof Boolean);
}

function isFunction(value) {
  return isFunctionTag(value);
}

function isObject(value) {
  return value === null || (Object(value) === value && !isFunctionTag(value));
}

function isUndefined(value) {
  return value === undefined;
}

function isSymbol(value) {
  return tag(value) === "[object Symbol]";
}

function isBigInt(value) {
  return tag(value) === "[object BigInt]";
}

function isBrowser() {
  return !isUndefined(globalThis.window);
}

function runtimeTypeName(value) {
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

module.exports = {
  isString,
  isNumber,
  isBoolean,
  isFunction,
  isObject,
  isUndefined,
  isSymbol,
  isBigInt,
  isBrowser,
  runtimeTypeName,
};
