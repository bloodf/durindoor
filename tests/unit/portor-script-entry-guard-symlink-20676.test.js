import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../../scripts/lib/is-main-module.mjs";

// OmniRoute #20676: entry guards must survive symlinked script paths.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portor-20676-"));
const real = path.join(dir, "real.mjs");
const link = path.join(dir, "link.mjs");
fs.writeFileSync(real, "export {};\n");
fs.symlinkSync(real, link);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("isMainModule (OmniRoute #20676)", () => {
  it("matches when argv[1] reaches the module through a symlink", () => {
    expect(isMainModule(pathToFileURL(real).href, link)).toBe(true);
  });

  it("matches the direct and relative paths", () => {
    expect(isMainModule(pathToFileURL(real).href, real)).toBe(true);
    expect(isMainModule(pathToFileURL(real).href, path.relative(process.cwd(), real))).toBe(true);
  });

  it("does not match another file or a missing argv", () => {
    expect(isMainModule(pathToFileURL(real).href, path.join(dir, "other.mjs"))).toBe(false);
    expect(isMainModule(pathToFileURL(real).href, undefined)).toBe(false);
  });
});
