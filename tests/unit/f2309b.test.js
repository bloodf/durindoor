import { describe, expect, it } from "vitest";
import { builtinModules } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveStableUUIDv4, getCodexFingerprintMode } from "../../open-sse/config/codexIdentity.js";

describe("client-safe provider registry", () => {
  it("does not import Node built-ins", () => {
    const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
    function scan(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) scan(path);
        else {
          const source = readFileSync(path, "utf8");
          const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["']([^"']+)["']/g);
          for (const [, specifier] of imports) {
            expect(specifier.startsWith("node:") || builtins.has(specifier), `${path}: ${specifier}`).toBe(false);
          }
        }
      }
    }
    scan(join(process.cwd(), "../open-sse/providers/registry"));
  });
  it("retains deterministic identity behavior", () => {
    expect(deriveStableUUIDv4("test")).toBe("9f86d081-884c-4d65-9a2f-eaa0c55ad015");
    expect(getCodexFingerprintMode({}, true)).toBe("session");
  });
});
