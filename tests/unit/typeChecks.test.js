/**
 * typeChecks helpers must match ECMAScript typeof tags without using typeof.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isBigInt,
  isBoolean,
  isBrowser,
  isFunction,
  isNumber,
  isObject,
  isString,
  isSymbol,
  isUndefined,
  runtimeTypeName,
} from "../../src/shared/utils/typeChecks.js";

const SOURCE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/shared/utils/typeChecks.js"),
  "utf8",
);

describe("typeChecks", () => {
  it("does not use the typeof operator in executable code", () => {
    const withoutComments = SOURCE
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(withoutComments).not.toMatch(/\btypeof\b/);
  });

  it("matches typeof string/number/boolean/function/object/undefined/symbol/bigint", () => {
    expect(isString("x")).toBe(true);
    expect(isString(new String("x"))).toBe(false);
    expect(isNumber(1)).toBe(true);
    expect(isNumber(Number.NaN)).toBe(true);
    expect(isNumber(new Number(1))).toBe(false);
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(new Boolean(false))).toBe(false);
    expect(isFunction(() => {})).toBe(true);
    expect(isFunction(async () => {})).toBe(true);
    expect(isObject(null)).toBe(true);
    expect(isObject([])).toBe(true);
    expect(isObject({})).toBe(true);
    expect(isObject(() => {})).toBe(false);
    expect(isUndefined(undefined)).toBe(true);
    expect(isUndefined(null)).toBe(false);
    expect(isSymbol(Symbol("s"))).toBe(true);
    expect(isBigInt(1n)).toBe(true);
  });

  it("runtimeTypeName matches ECMAScript typeof tags (arrays → array)", () => {
    expect(runtimeTypeName("x")).toBe("string");
    expect(runtimeTypeName(1)).toBe("number");
    expect(runtimeTypeName(true)).toBe("boolean");
    expect(runtimeTypeName(() => {})).toBe("function");
    expect(runtimeTypeName(null)).toBe("object");
    expect(runtimeTypeName([])).toBe("array");
    expect(runtimeTypeName({})).toBe("object");
    expect(runtimeTypeName(undefined)).toBe("undefined");
  });

  it("exposes isBrowser without throwing", () => {
    expect(isBoolean(isBrowser())).toBe(true);
  });
});
