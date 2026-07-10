import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { resolveCliAppDir } from "../../cli/scripts/cliBuildPaths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(__dirname, "../../cli/scripts");

/**
 * Upstream #2479 lets a caller stage the CLI app bundle outside the
 * in-place `cli/app` tree via `DURINDOOR_CLI_APP_DIR`. The resolver test below
 * covers the branch math; the wiring checks make sure BOTH consumers
 * (`build-cli.js` for the standalone copy and `buildMitm.js` for the MITM
 * bundle destination) actually read from the resolver instead of a hard-coded
 * `path.join(cliDir, "app")`, so a regression can't silently re-pin one path.
 */
describe("resolveCliAppDir (staged CLI build path)", () => {
  const CLI_DIR = path.resolve("/repo/cli");

  it("defaults to <cliDir>/app when no override is set", () => {
    expect(resolveCliAppDir(CLI_DIR, {})).toBe(path.join(CLI_DIR, "app"));
  });

  it("honors DURINDOOR_CLI_APP_DIR verbatim (absolute staged path)", () => {
    const staged = "/tmp/staged-cli-bundle";
    expect(resolveCliAppDir(CLI_DIR, { DURINDOOR_CLI_APP_DIR: staged })).toBe(staged);
  });

  it("keeps a relative override verbatim (process-relative, not cliDir-relative)", () => {
    // Packagers pass a path relative to their own cwd; the resolver must NOT
    // rebase it onto cliDir, or staged builds would land in the wrong place.
    expect(resolveCliAppDir(CLI_DIR, { DURINDOOR_CLI_APP_DIR: "out/cli-app" })).toBe("out/cli-app");
  });

  it("preserves surrounding whitespace in the override value", () => {
    const raw = "  /tmp/staged  ";
    expect(resolveCliAppDir(CLI_DIR, { DURINDOOR_CLI_APP_DIR: raw })).toBe(raw);
  });

  it("falls back to default when override is an empty string", () => {
    expect(resolveCliAppDir(CLI_DIR, { DURINDOOR_CLI_APP_DIR: "" })).toBe(path.join(CLI_DIR, "app"));
  });
});

describe("staged build path wiring", () => {
  const read = (name) => fs.readFileSync(path.join(SCRIPTS, name), "utf8");

  it("build-cli.js derives cliAppDir from the resolver, not a hard-coded join", () => {
    const src = read("build-cli.js");
    expect(src).toMatch(/resolveCliAppDir\(cliDir\)/);
    expect(src).not.toMatch(/cliAppDir\s*=\s*path\.join\(cliDir,\s*["']app["']\)/);
  });

  it("buildMitm.js derives its MITM destination from the resolver app dir", () => {
    const src = read("buildMitm.js");
    expect(src).toMatch(/cliAppDir\s*=\s*resolveCliAppDir\(cliDir\)/);
    expect(src).toMatch(/cliMitmDir\s*=\s*path\.join\(cliAppDir,\s*["']src["'],\s*["']mitm["']\)/);
    expect(src).not.toMatch(/cliMitmDir\s*=\s*path\.join\(cliDir,\s*["']app["']/);
  });
});
