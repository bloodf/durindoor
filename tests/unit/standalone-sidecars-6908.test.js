import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  STANDALONE_SIDECARS,
  copyRequiredStandaloneSidecars,
} = require("../../cli/scripts/standaloneSidecars.js");
const { applyHeadResponseGuard, isHeadRequest } = require("../../head-response-guard.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

/**
 * OmniRoute #6908: upstream shipped a standalone bundle whose entry imported
 * `head-response-guard.cjs` without the packaging step copying it, so every
 * release dist crashed at boot with MODULE_NOT_FOUND. durindoor's equivalent
 * is `custom-server.js` requiring `./head-response-guard.cjs` (#6608) while
 * living OUTSIDE Next's standalone trace — both the root standalone build
 * (`scripts/build-app.mjs`) and the CLI bundle build
 * (`cli/scripts/build-cli.js` step 3a) must copy the sidecar, and the CLI
 * npm package must actually ship it under `app/`.
 */
describe("copyRequiredStandaloneSidecars", () => {
  let tmpRoot;
  let appDir;
  let cliAppDir;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "standalone-sidecars-"));
    appDir = path.join(tmpRoot, "app-src");
    cliAppDir = path.join(tmpRoot, "cli-app");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "custom-server.js"), "// custom server\n");
    fs.writeFileSync(path.join(appDir, "head-response-guard.cjs"), "// head guard\n");
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("copies every required sidecar into the bundle with exact contents", () => {
    const written = copyRequiredStandaloneSidecars(appDir, cliAppDir);
    expect(written).toHaveLength(STANDALONE_SIDECARS.length);
    for (const name of STANDALONE_SIDECARS) {
      const dest = path.join(cliAppDir, name);
      expect(fs.existsSync(dest), `${name} must land in the CLI bundle`).toBe(true);
      expect(fs.readFileSync(dest, "utf8")).toBe(fs.readFileSync(path.join(appDir, name), "utf8"));
    }
  });

  it("fails hard before writing anything when a sidecar is missing", () => {
    fs.rmSync(path.join(appDir, "head-response-guard.cjs"));
    expect(() => copyRequiredStandaloneSidecars(appDir, cliAppDir)).toThrow(/MODULE_NOT_FOUND/);
    // Preflight-then-copy: NO partial bundle is staged, so a failed build can
    // never leave a custom-server-without-guard artifact behind.
    expect(fs.existsSync(path.join(cliAppDir, "head-response-guard.cjs"))).toBe(false);
    expect(fs.existsSync(path.join(cliAppDir, "custom-server.js"))).toBe(false);
  });

  it("lists head-response-guard.cjs as a required sidecar", () => {
    expect(STANDALONE_SIDECARS).toContain("head-response-guard.cjs");
    expect(STANDALONE_SIDECARS).toContain("custom-server.js");
  });
});

describe("standalone artifact packaging (repo manifest + build wiring)", () => {
  it("cli package.json `files` ships the app/ dir that receives the sidecars", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "cli", "package.json"), "utf8"));
    // The sidecars land in <cliAppDir>/<name> = cli/app/<name>; the manifest
    // must publish `app` or the tarball omits them (npm files list).
    expect(pkg.files).toContain("app");
    // Guard rail against someone switching to per-file entries and dropping
    // the sidecar from the tarball.
    if (pkg.files.some((f) => f.startsWith("app/"))) {
      expect(pkg.files).toContain("app/head-response-guard.cjs");
    }
  });

  it("build-cli.js step 3a copies sidecars via the shared helper (never a silent skip)", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "cli", "scripts", "build-cli.js"), "utf8");
    expect(src).toMatch(/require\(["']\.\/standaloneSidecars["']\)/);
    expect(src).toMatch(/copyRequiredStandaloneSidecars\(appDir,\s*cliAppDir\)/);
  });

  it("root standalone build copies head-response-guard.cjs next to custom-server.js", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "build-app.mjs"), "utf8");
    expect(src).toMatch(/custom-server\.js["'].*standaloneDir/s);
    expect(src).toContain("head-response-guard.cjs");
  });

  it("custom-server.js requires the sidecar at its bundle-relative path", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "custom-server.js"), "utf8");
    expect(src).toMatch(/require\(["']\.\/head-response-guard\.cjs["']\)/);
  });

  // Upstream #6908 regression guard, derived from source like the original:
  // EVERY root-level relative require in custom-server.js must be shipped by
  // the sidecar sync — otherwise the next added sidecar recreates the exact
  // boot crash (MODULE_NOT_FOUND) this port fixes. Requires into `src/` and
  // `open-sse/` are excluded: those trees are copied wholesale by their own
  // build steps.
  it("every root-level relative require of custom-server.js is a shipped sidecar", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "custom-server.js"), "utf8");
    const rootRequires = [...src.matchAll(/require\(["']\.\/([^"']+)["']\)/g)]
      .map((m) => m[1])
      // `server.js` is generated by the Next standalone build (copied in
      // wholesale by build step 3), and src/ + open-sse/ trees are covered by
      // their own copy steps — only true repo-root sidecars belong in
      // STANDALONE_SIDECARS.
      .filter((p) => p !== "server.js" && !p.startsWith("src/") && !p.startsWith("open-sse/"));
    expect(rootRequires.length).toBeGreaterThan(0);
    for (const rel of rootRequires) {
      expect(
        STANDALONE_SIDECARS,
        `custom-server.js requires ./${rel} but STANDALONE_SIDECARS does not ship it — the CLI bundle would crash at boot (MODULE_NOT_FOUND)`
      ).toContain(rel);
    }
  });
});

describe("head-response-guard.cjs (extracted #6608 behavior, unchanged)", () => {
  const makeRes = () => {
    const calls = { ended: 0, endArgs: null };
    return {
      calls,
      write: () => true,
      end(...args) {
        calls.ended += 1;
        calls.endArgs = args;
        return this;
      },
    };
  };

  it("detects HEAD case-insensitively and defaults others to non-HEAD", () => {
    expect(isHeadRequest({ method: "HEAD" })).toBe(true);
    expect(isHeadRequest({ method: "head" })).toBe(true);
    expect(isHeadRequest({ method: "GET" })).toBe(false);
    expect(isHeadRequest({})).toBe(false);
  });

  it("leaves non-HEAD responses untouched", () => {
    const res = makeRes();
    const origWrite = res.write;
    const origEnd = res.end;
    applyHeadResponseGuard({ method: "POST" }, res);
    expect(res.write).toBe(origWrite);
    expect(res.end).toBe(origEnd);
  });

  it("drops body bytes but still calls the real end with a single callback", () => {
    const res = makeRes();
    applyHeadResponseGuard({ method: "HEAD" }, res);
    let writeCb = 0;
    expect(res.write(Buffer.from("body"), () => { writeCb += 1; })).toBe(true);
    expect(writeCb).toBe(1);
    let endCb = 0;
    res.end("ignored-chunk", () => { endCb += 1; });
    // Real end received exactly ONE function arg (the callback) — no chunk.
    expect(res.calls.ended).toBe(1);
    expect(res.calls.endArgs).toHaveLength(1);
    expect(typeof res.calls.endArgs[0]).toBe("function");
    res.calls.endArgs[0]();
    expect(endCb).toBe(1);
  });

  it("supports the (cb)-only end arity without swallowing the callback", () => {
    const res = makeRes();
    applyHeadResponseGuard({ method: "HEAD" }, res);
    let endCb = 0;
    res.end(() => { endCb += 1; });
    expect(res.calls.ended).toBe(1);
    expect(typeof res.calls.endArgs[0]).toBe("function");
    res.calls.endArgs[0]();
    expect(endCb).toBe(1);
  });
});
