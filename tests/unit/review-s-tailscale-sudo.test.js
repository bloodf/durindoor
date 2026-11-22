import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Tailscale sudo credential boundary", () => {
  it("resolves trusted sudo before passing a password to any sudo process", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/lib/tunnel/tailscale/tailscale.js"), "utf8");

    expect(source).toContain('resolveTrustedUnixBinary("sudo")');
    expect(source).toContain('spawn(sudoBin, ["-S", "installer"');
    expect(source).toContain('spawn(sudoBin, ["-S", "sh", tmpScript]');
    expect(source).toContain('spawn(sudoBin, ["-S", tailscaledBin');
    expect(source).not.toMatch(/spawn\(["']sudo["']/);
    expect(source).toContain("Cannot run Tailscale installer:");
  });
});
