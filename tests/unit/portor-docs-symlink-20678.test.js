import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("runs the documentation check through a symlinked checkout", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "docs-symlink-"));
  try {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const link = path.join(dir, "checkout");
    symlinkSync(root, link, "dir");
    const init = spawnSync("git", ["init", "-q", dir]);
    expect(init.status).toBe(0);
    const run = (script) => spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
    const direct = run(path.join(root, "scripts/check-docs.mjs"));
    const linked = run(path.join(link, "scripts/check-docs.mjs"));
    expect(direct.status).toBe(1);
    expect(direct.stderr).not.toBe("");
    expect(linked.status).toBe(direct.status);
    expect(linked.stderr).toBe(direct.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
