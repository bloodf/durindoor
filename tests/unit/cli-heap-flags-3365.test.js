import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { buildNodeArgs, resolveHeapFlags } = require("../../cli/hooks/nodeFlags.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CLI_SOURCE = readFileSync(path.join(ROOT, "cli", "cli.js"), "utf8");

describe("CLI heap flags (upstream #3368)", () => {
  it("keeps the existing 6144 MB default", () => {
    expect(resolveHeapFlags({})).toEqual(["--max-old-space-size=6144"]);
  });

  it("routes both server spawns through buildNodeArgs", () => {
    expect(CLI_SOURCE.match(
      /spawn\(RUNTIME, buildNodeArgs\(serverPath, process\.env\), \{/g,
    )).toHaveLength(2);
    expect(CLI_SOURCE).not.toContain("--max-old-space-size=");
  });

  it("prefers NINEROUTER_MAX_OLD_SPACE_SIZE", () => {
    expect(resolveHeapFlags({
      NINEROUTER_MAX_OLD_SPACE_SIZE: "8192",
      NODE_OPTIONS: "--max-old-space-size=4096",
    })).toEqual(["--max-old-space-size=8192"]);
  });

  it("does not override a NODE_OPTIONS heap setting", () => {
    expect(resolveHeapFlags({ NODE_OPTIONS: "--max-old-space-size=4096" })).toEqual([]);
  });

  it("emits no heap flag when explicitly disabled with 0", () => {
    expect(resolveHeapFlags({ NINEROUTER_MAX_OLD_SPACE_SIZE: "0" })).toEqual([]);
  });

  it("falls back to the default for a non-numeric value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveHeapFlags({ NINEROUTER_MAX_OLD_SPACE_SIZE: "large" }))
        .toEqual(["--max-old-space-size=6144"]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects non-decimal numeric forms", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveHeapFlags({ NINEROUTER_MAX_OLD_SPACE_SIZE: "0x10" }))
        .toEqual(["--max-old-space-size=6144"]);
      expect(resolveHeapFlags({ NINEROUTER_MAX_OLD_SPACE_SIZE: "1e3" }))
        .toEqual(["--max-old-space-size=6144"]);
      expect(resolveHeapFlags({ NINEROUTER_MAX_OLD_SPACE_SIZE: "+5" }))
        .toEqual(["--max-old-space-size=6144"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("builds server argv through one helper", () => {
    expect(buildNodeArgs("/app/server.js", { NINEROUTER_MAX_OLD_SPACE_SIZE: "8192" }))
      .toEqual(["--dns-result-order=ipv4first", "--max-old-space-size=8192", "/app/server.js"]);
  });
});
