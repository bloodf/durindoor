import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// OmniRoute #20678: a gate run through a symlinked checkout path must execute, not exit 0 silently.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portor-20678-"));
const linkedRoot = path.join(dir, "repo");
fs.symlinkSync(repoRoot, linkedRoot, "dir");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("script entry guards through a symlinked checkout (OmniRoute #20678)", () => {
  it("runs gen-provider-catalog --check when invoked via the symlink", () => {
    const run = spawnSync(process.execPath, [path.join(linkedRoot, "scripts/gen-provider-catalog.mjs"), "--check"], {
      cwd: repoRoot, encoding: "utf8", timeout: 60_000,
    });
    expect(`${run.stdout}${run.stderr}`).toContain("docs/providers/catalog.mdx");
  }, 70_000);

  it("leaves no raw argv[1] entry comparisons in scripts/", () => {
    const raw = /^(?=.*import\.meta\.url)(?=.*process\.argv\[1\])(?=.*===).*$/m;
    const offenders = fs.readdirSync(path.join(repoRoot, "scripts"))
      .filter((f) => f.endsWith(".mjs"))
      .filter((f) => raw.test(fs.readFileSync(path.join(repoRoot, "scripts", f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
