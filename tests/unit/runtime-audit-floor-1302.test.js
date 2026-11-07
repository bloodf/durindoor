import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// Patched floors for runtime advisories tracked in #1302 / #1310.
const FLOORS = [
  { lock: "pnpm-lock.yaml", pkg: "node-forge", floor: "1.4.2" },
  { lock: "pnpm-lock.yaml", pkg: "body-parser", floor: "2.4.0" },
  { lock: "pnpm-lock.yaml", pkg: "qs", floor: "6.17.1" },
  { lock: "cli/pnpm-lock.yaml", pkg: "node-forge", floor: "1.4.2" },
];

// pnpm stores config dependencies and application dependencies in separate YAML documents.
function packageVersions(source, name) {
  const documents = parseAllDocuments(source);
  for (const document of documents) if (document.errors.length) throw document.errors[0];
  const application = documents.map(document => document.toJS())
    .filter(document => document?.importers?.["."]?.dependencies && document.packages);
  if (application.length !== 1) throw new Error("Exactly one application lock document required");
  return Object.keys(application[0].packages).filter(key => key.startsWith(`${name}@`))
    .map(key => key.slice(name.length + 1).split("(")[0]);
}

function parts(version) {
  return String(version).split("-")[0].split(".").map(Number);
}

function isAtLeast(version, floor) {
  const [a, b] = [parts(version), parts(floor)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

describe("runtime audit floors (#1302)", () => {
  it("reads a vulnerable application package after the package-manager lock document", () => {
    const source = "importers: { '.': { packageManagerDependencies: {} } }\npackages: {}\n---\nimporters: { '.': { dependencies: {} } }\npackages: { 'node-forge@1.4.1': {} }\n";
    const versions = packageVersions(source, "node-forge");
    expect(versions).toEqual(["1.4.1"]);
    expect(isAtLeast(versions[0], "1.4.2")).toBe(false);
  });
  it("rejects a lock without an application dependency document", () => {
    expect(() => packageVersions("packages: {}", "node-forge")).toThrow(/application lock/);
  });

  it.each(FLOORS)("$lock resolves $pkg >= $floor", ({ lock, pkg, floor }) => {
    const versions = packageVersions(readFileSync(path.join(ROOT, lock), "utf8"), pkg);
    expect(versions.length, `${pkg} missing from ${lock}`).toBeGreaterThan(0);
    for (const version of versions) {
      expect(version, "A resolved semantic version is required").toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
      expect(isAtLeast(version, floor), `${pkg}@${version}`).toBe(true);
    }
  });
});
