import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const RUNNER = path.join(ROOT, "scripts", "run-eslint.mjs");

/** Write a stand-in ESLint entry point that reports which copy was executed. */
function writeFakeEslint(file, marker) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `process.stdout.write("${marker}\\n");\n`);
}

function runIn(cwd, args = ["--version"]) {
  return spawnSync(process.execPath, [RUNNER, ...args], { cwd, encoding: "utf8" });
}

describe("scripts/run-eslint.mjs", () => {
  it("runs the top-level ESLint link when the checkout has one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "run-eslint-direct-"));
    try {
      writeFakeEslint(path.join(dir, "node_modules/eslint/bin/eslint.js"), "direct-eslint");
      const result = runIn(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("direct-eslint");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the pnpm virtual store when the top-level link is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "run-eslint-store-"));
    try {
      writeFakeEslint(
        path.join(dir, "node_modules/.pnpm/eslint@9.99.0/node_modules/eslint/bin/eslint.js"),
        "store-eslint",
      );
      const result = runIn(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("store-eslint");
      expect(result.stdout).not.toContain("direct-eslint");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a clear failure when no ESLint copy can be resolved", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "run-eslint-missing-"));
    try {
      const result = runIn(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unable to locate ESLint");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
