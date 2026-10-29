import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/** Minimum undici floor from upstream 08ef047 / issue #1360 (v7.30.1 security release). */
const UNDICI_FLOOR = "7.30.1";

function parseCaretOrExact(range) {
  const match = String(range || "").trim().match(/^\^?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function isAtLeast(version, floor) {
  if (version.major !== floor.major) return version.major > floor.major;
  if (version.minor !== floor.minor) return version.minor > floor.minor;
  return version.patch >= floor.patch;
}

describe("undici security floor (#1360)", () => {
  it(`package.json declares undici ^${UNDICI_FLOOR} or newer`, () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const declared = pkg.dependencies?.undici;
    const parsed = parseCaretOrExact(declared);
    const floor = parseCaretOrExact(UNDICI_FLOOR);
    expect(parsed, `unexpected undici range: ${declared}`).not.toBeNull();
    expect(isAtLeast(parsed, floor)).toBe(true);
  });

  it(`overrides pin nested undici to ^${UNDICI_FLOOR}`, () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.overrides?.undici).toBe(`^${UNDICI_FLOOR}`);
  });

  it(`resolved node_modules/undici is >=${UNDICI_FLOOR}`, () => {
    const installed = JSON.parse(
      readFileSync(path.join(ROOT, "node_modules", "undici", "package.json"), "utf8"),
    );
    const parsed = parseCaretOrExact(installed.version);
    const floor = parseCaretOrExact(UNDICI_FLOOR);
    expect(parsed, `unexpected installed version: ${installed.version}`).not.toBeNull();
    expect(isAtLeast(parsed, floor)).toBe(true);
  });
});
