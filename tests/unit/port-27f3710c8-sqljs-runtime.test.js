import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/**
 * Guards the port of upstream 9router 27f3710c8 ("ship sql.js so the pure-JS DB
 * fallback can start").
 *
 * src/lib/db/driver.js resolves a SQLite adapter in order:
 *   Bun:  bun:sqlite -> sql.js
 *   Node: better-sqlite3 -> node:sqlite (>= 22.5) -> sql.js
 *
 * sql.js is therefore the last line of defence: on a host where the native
 * binding failed to build and Node is older than 22.5, it is the only driver
 * left, and losing it means the app boots with no database at all.
 *
 * sql.js loads `dist/sql-wasm.wasm` at runtime through emscripten's default
 * locateFile, i.e. relative to the directory of `sql-wasm.js`. That asset is
 * never referenced by an import statement, so Next's file tracer copies the JS
 * entry into `.next/standalone` and silently drops the wasm beside it. Both
 * packaging surfaces must repair this explicitly:
 *   - scripts/build-app.mjs for `npm run build` / systemd standalone deploys
 *   - Dockerfile for the container image
 */
describe("sql.js pure-JS DB fallback packaging (upstream 27f3710c8)", () => {
  it("keeps sql.js as the terminal driver in the fallback chain", () => {
    const driverSrc = readFileSync(path.join(ROOT, "src", "lib", "db", "driver.js"), "utf8");
    expect(driverSrc).toContain("trySqlJs");
    // The last-resort position is what makes the missing wasm fatal rather than cosmetic.
    expect(driverSrc).toMatch(/if \(!adapter\) adapter = await trySqlJs\(\);/);
  });

  it("ships the wasm asset in the installed sql.js package", () => {
    // `sql.js` only exports "." and "./dist/*": resolving package.json throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED, so assets must come from subpath exports.
    expect(() => require.resolve("sql.js/dist/sql-wasm.js")).not.toThrow();
    // If upstream sql.js ever renames this asset, the copy steps below break loudly here.
    expect(existsSync(require.resolve("sql.js/dist/sql-wasm.wasm"))).toBe(true);
  });

  it("build-app.mjs copies sql-wasm.wasm into the standalone bundle", () => {
    const buildSrc = readFileSync(path.join(ROOT, "scripts", "build-app.mjs"), "utf8");
    expect(buildSrc).toContain('"node_modules", "sql.js", "dist"');
    expect(buildSrc).toContain('"sql-wasm.wasm"');
  });

  it("Dockerfile copies the sql.js package into the runtime stage", () => {
    const dockerSrc = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    expect(dockerSrc).toContain(
      "COPY --from=builder /app/node_modules/sql.js ./node_modules/sql.js",
    );
  });

  it("copies both assets, not just the traced JS entry", () => {
    const buildSrc = readFileSync(path.join(ROOT, "scripts", "build-app.mjs"), "utf8");
    // The wasm is the whole point: a copy step that only moved sql-wasm.js would
    // reproduce the exact bug this port fixes.
    const assetList = buildSrc.match(/\["sql-wasm\.js", "sql-wasm\.wasm"\]/);
    expect(assetList).not.toBeNull();
  });
});
