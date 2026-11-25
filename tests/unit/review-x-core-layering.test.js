import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const handlers = path.join(root, "open-sse/handlers");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(name) : /\.[cm]?[jt]sx?$/.test(name) ? [name] : [];
  });
}

describe("core dependency boundaries", () => {
  it("keeps utilities and translators independent of handlers", () => {
    const violations = [];
    for (const directory of ["open-sse/utils", "open-sse/translator"]) {
      for (const file of sourceFiles(path.join(root, directory))) {
        const source = readFileSync(file, "utf8");
        const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bimport\s*)["']([^"']+)["']/g);
        for (const [, specifier] of imports) {
          const target = specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : path.resolve(root, specifier.replace(/^@\//, ""));
          if (target === handlers || target.startsWith(`${handlers}${path.sep}`)) {
            violations.push(`${path.relative(root, file)}: ${specifier}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("does not retain the unused Responses handler", () => {
    expect(existsSync(path.join(handlers, "responsesHandler.js"))).toBe(false);
  });
});
