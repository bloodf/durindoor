import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// Patched floors for runtime advisories tracked in #1302 / #1310.
const FLOORS = [
  { lock: "package-lock.json", pkg: "node-forge", floor: "1.4.2" },
  { lock: "package-lock.json", pkg: "body-parser", floor: "2.4.0" },
  { lock: "package-lock.json", pkg: "qs", floor: "6.17.1" },
  { lock: "cli/package-lock.json", pkg: "node-forge", floor: "1.4.2" },
];

function parts(version) {
  return String(version).split("-")[0].split(".").map(Number);
}

function isAtLeast(version, floor) {
  const [a, b] = [parts(version), parts(floor)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

describe("runtime audit floors (#1302)", () => {
  it.each(FLOORS)("$lock resolves $pkg >= $floor", ({ lock, pkg, floor }) => {
    const packages = JSON.parse(readFileSync(path.join(ROOT, lock), "utf8")).packages;
    const hits = Object.entries(packages).filter(([key]) => key.endsWith(`node_modules/${pkg}`));
    expect(hits.length, `${pkg} missing from ${lock}`).toBeGreaterThan(0);
    for (const [key, meta] of hits) {
      expect(isAtLeast(meta.version, floor), `${key}@${meta.version}`).toBe(true);
    }
  });
});
