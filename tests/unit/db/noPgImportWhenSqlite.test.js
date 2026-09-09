// Static guard: the `pg` module is never imported when the engine is
// sqlite. This test does not boot any adapter; it asserts the contract
// at the module-graph level.

import { describe, it, expect } from "vitest";
import path from "node:path";

const REPO = path.resolve(new URL(".", import.meta.url).pathname, "../../..");

describe("noPgImportWhenSqlite — static guard", () => {
  it("the settings row defaults to databaseEngine = 'sqlite'", async () => {
    const fs = await import("node:fs");
    const file = path.join(REPO, "src/lib/db/repos/settingsRepo.js");
    const src = fs.readFileSync(file, "utf-8");
    expect(src).toMatch(/databaseEngine:\s*"sqlite"/);
  });

  it("postgresFallback exposes the SQLite-only test override", async () => {
    const mod = await import("@/lib/db/postgresFallback.js");
    expect(typeof mod.__setSqliteOnlyForTests).toBe("function");
  });

  it("the pg module is imported only by the adapter and the fallback wrapper", async () => {
    const fs = await import("node:fs");
    function* walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else if (/\.(js|mjs|jsx)$/.test(entry.name)) yield full;
      }
    }
    const imports = [];
    for (const f of walk(path.join(REPO, "src"))) {
      const s = fs.readFileSync(f, "utf-8");
      if (/from\s+["']pg["']/.test(s) || /require\(["']pg["']\)/.test(s)) {
        imports.push(f.replace(REPO + "/", ""));
      }
    }
    // The pg module may only be imported by the adapter (which exposes
    // it) and the fallback wrapper (which is the single entry point
    // for booting PG). No repo, no settings module, no API route may
    // import it directly.
    for (const f of imports) {
      expect(
        f === "src/lib/db/adapters/pgAdapter.js" || f === "src/lib/db/postgresFallback.js",
        `${f} should not import pg directly`
      ).toBe(true);
    }
  });
});