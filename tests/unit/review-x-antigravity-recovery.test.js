import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.isFile() ? [fullPath] : [];
  });
}

describe("Antigravity browser recovery stays unwired", () => {
  it("documents password typing and the disabled production path", () => {
    const doc = fs.readFileSync(path.join(root, "docs/operations/antigravity-rotation.mdx"), "utf8");
    const helper = fs.readFileSync(path.join(root, "src/lib/antigravity/browserRecovery.js"), "utf8");

    expect(doc).toMatch(/no production path calls it today/i);
    expect(doc).toMatch(/refuses `enroll`, `replace`, and `enable`/);
    expect(doc).toMatch(/types the stored password.*clicks the Next button/i);
    expect(doc).not.toMatch(/real browser path does not type a password/i);
    expect(helper.split("\n", 1)[0]).toMatch(/not wired into the production path/i);
  });

  it("finds no production imports of the recovery helper or store", () => {
    const roots = ["src", "open-sse", "scripts"];
    const offenders = roots.flatMap((relativeRoot) => sourceFiles(path.join(root, relativeRoot)))
      .filter((file) => !(file.startsWith(path.join(root, "src/lib/antigravity"))
        && file.startsWith(path.join(root, "src"))))
      .filter((file) => {
        const contents = fs.readFileSync(file, "utf8");
        return /(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)["'][^"']*(?:browserRecovery|recoveryStore)(?:\.js)?["']/.test(contents)
          || /(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)["'][^"']*["'][\s\S]{0,200}\b(?:runBrowserRecovery|recoveryStore)\b/.test(contents);
      });

    expect(offenders).toEqual([]);
  });
});
