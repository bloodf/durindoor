// Guards the Node version claim in docs/deployment/compatibility.mdx (#1143):
// app, CLI, Dockerfile, .nvmrc and every workflow must name the same Node line.
// The exact pin lives in .nvmrc; manifests carry the >=24.22.2 <25 range.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const APP_PACKAGE = JSON.parse(read("package.json"));
const NVMRC = read(".nvmrc").trim();
const APP_NODE = APP_PACKAGE.engines.node;
const PNPM = "pnpm@12.18.0";

describe("Node version alignment", () => {
  it("pins one exact Node for the app and documents it", () => {
    expect(NVMRC).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_NODE).toBe(`>=${NVMRC} <25`);
    expect(read("docs/deployment/compatibility.mdx")).toContain(`\`${APP_NODE}\``);
  });

  it("makes every package manager pnpm 12.18.0 with the same Node range", () => {
    for (const pkg of ["package.json", "cli/package.json", "tests/package.json", "website/package.json"]) {
      const parsed = JSON.parse(read(pkg));
      expect(parsed.packageManager).toBe(PNPM);
      expect(parsed.engines.node).toBe(APP_NODE);
    }
  });

  it("runs the test package on that Node", () => {
    const tests = JSON.parse(read("tests/package.json"));
    expect(tests.engines).toEqual({ node: APP_NODE });
  });

  it("installs a CLI-runtime better-sqlite3 and sql.js that satisfy the app's caret ranges", () => {
    const runtime = read("cli/hooks/sqliteRuntime.js");
    const parse = (version) => version.match(/^\^?(\d+)\.(\d+)\.(\d+)$/).slice(1).map(Number);
    // Caret range: same major, and not older than the range's base version.
    const satisfiesCaret = (version, range) => {
      const [major, minor, patch] = parse(version);
      const [baseMajor, baseMinor, basePatch] = parse(range);
      return major === baseMajor && (minor > baseMinor || (minor === baseMinor && patch >= basePatch));
    };
    for (const [constant, name] of [["BETTER_SQLITE3", "better-sqlite3"], ["SQL_JS", "sql.js"]]) {
      const pinned = runtime.match(new RegExp(`${constant}_VERSION = "([^"]+)"`))?.[1];
      // Windows runs npm through a shell, which mangles "^" ranges, so the pin stays exact.
      expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
      expect(satisfiesCaret(pinned, APP_PACKAGE.dependencies[name] ?? APP_PACKAGE.optionalDependencies[name])).toBe(true);
    }
  });

  it("builds the Docker image on that Node", () => {
    expect(read("Dockerfile")).toContain(`ARG NODE_IMAGE=node:${NVMRC}-alpine`);
  });

  it("runs every workflow on that Node", () => {
    const workflows = readdirSync(path.join(ROOT, ".github/workflows")).filter((name) => name.endsWith(".yml"));
    const versions = workflows.flatMap((name) => [...read(`.github/workflows/${name}`).matchAll(/^\s*node-version:\s*([^\s#]+)/gm)].map((m) => m[1]));
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set([NVMRC]));
  });
});
