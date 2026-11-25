import { describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

describe("OmniRoute #21033 offline postinstall", () => {
  it("does not invoke npm when runtime dependencies are missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "durindoor-postinstall-"));
    try {
      const npm = path.join(dir, "npm");
      const log = path.join(dir, "npm-called");
      writeFileSync(npm, `#!/bin/sh\ntouch '${log}'\nexit 1\n`);
      chmodSync(npm, 0o755);
      const script = fileURLToPath(new URL("../../cli/hooks/postinstall.js", import.meta.url));
      const result = spawnSync(process.execPath, [script], {
        env: { PATH: `${dir}${path.delimiter}${process.env.PATH}`, HOME: dir, DATA_DIR: path.join(dir, "data") },
        encoding: "utf8",
        timeout: 10000,
      });
      expect(result.status).toBe(0);
      expect(existsSync(log)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
