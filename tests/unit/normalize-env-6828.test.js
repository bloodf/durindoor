import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { normalizeProcessEnv } = require("../../src/shared/utils/normalizeEnv.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/**
 * Guards the port of OmniRoute #6828 (upstream #6824):
 * Docker `-e KEY=` sets KEY to the empty string, which then overrides real
 * values the app would otherwise resolve and crashes the container in a
 * restart loop. normalizeProcessEnv() deletes exactly the `""` entries before
 * app modules load, so "" behaves like "not set".
 *
 * The predicate MUST be `value === ""` — never falsy/trim — so meaningful
 * strings ("0", "false", whitespace) survive untouched.
 */
describe("normalizeProcessEnv (OmniRoute #6828)", () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL);
  });

  it("deletes empty-string entries, treating them as unset", () => {
    const env = { DOCKER_BLANK: "", PERSISTED: "real-value" };
    normalizeProcessEnv(env);
    expect(env).not.toHaveProperty("DOCKER_BLANK");
    expect(env.PERSISTED).toBe("real-value");
  });

  it("preserves the '0' string (falsy-looking but meaningful)", () => {
    const env = { RETRY_COUNT: "0", EMPTY: "" };
    normalizeProcessEnv(env);
    expect(env.RETRY_COUNT).toBe("0");
    expect(env).not.toHaveProperty("EMPTY");
  });

  it("preserves the 'false' string (falsy-looking but meaningful)", () => {
    const env = { FEATURE_FLAG: "false", EMPTY: "" };
    normalizeProcessEnv(env);
    expect(env.FEATURE_FLAG).toBe("false");
    expect(env).not.toHaveProperty("EMPTY");
  });

  it("preserves whitespace-only and ordinary nonempty values", () => {
    const env = { PAD: " ", INDENT: "\t", NAME: "durindoor", EMPTY: "" };
    normalizeProcessEnv(env);
    expect(env.PAD).toBe(" ");
    expect(env.INDENT).toBe("\t");
    expect(env.NAME).toBe("durindoor");
    expect(env).not.toHaveProperty("EMPTY");
  });

  it("leaves an env with no empty values completely unchanged", () => {
    const env = { A: "1", B: "two", C: "three " };
    normalizeProcessEnv(env);
    expect(env).toEqual({ A: "1", B: "two", C: "three " });
  });

  it("defaults to process.env and is idempotent", () => {
    process.env.__OM6828_BLANK__ = "";
    process.env.__OM6828_REAL__ = "x";
    normalizeProcessEnv();
    normalizeProcessEnv();
    expect(process.env).not.toHaveProperty("__OM6828_BLANK__");
    expect(process.env.__OM6828_REAL__).toBe("x");
    delete process.env.__OM6828_REAL__;
  });

  it("returns the same env object it mutated", () => {
    const env = { K: "" };
    expect(normalizeProcessEnv(env)).toBe(env);
  });
});

describe("custom-server.js pre-require normalization contract", () => {
  const serverSrc = readFileSync(path.join(ROOT, "custom-server.js"), "utf8");

  it("calls normalizeProcessEnv() as its first statement, before any require", () => {
    const lines = serverSrc.split("\n");
    const firstStatement = lines.find((l) => l.trim() !== "" && !l.trim().startsWith("//"));
    expect(firstStatement).toContain("normalizeProcessEnv()");
    expect(firstStatement).toContain('require("./src/shared/utils/normalizeEnv")');
  });

  it("normalizes before app modules can snapshot blank env (child-process entrypoint check)", () => {
    // Require the REAL entrypoint as a module (require.main !== module, so the
    // server does not start) with a blank marker env set before the require.
    // The entrypoint's first statement must delete the marker, so any module
    // loaded afterward observes it as absent — this catches a missing helper
    // file, wrong require path, or reordering below another top-level require.
    const script = `
      process.env.OM6828_MARKER = "";
      process.env.OM6828_KEEP = "0";
      require(${JSON.stringify(path.join(ROOT, "custom-server.js"))});
      console.log(JSON.stringify({
        marker: process.env.OM6828_MARKER === undefined ? "absent" : process.env.OM6828_MARKER,
        keep: process.env.OM6828_KEEP,
      }));
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ marker: "absent", keep: "0" });
  });
});

describe("runtime packaging ships the helper", () => {
  it("build-app.mjs copies normalizeEnv.js into the standalone bundle", () => {
    const buildSrc = readFileSync(path.join(ROOT, "scripts", "build-app.mjs"), "utf8");
    expect(buildSrc).toContain('"src", "shared", "utils", "normalizeEnv.js"');
  });

  it("Dockerfile copies normalizeEnv.js beside custom-server.js", () => {
    const dockerSrc = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    expect(dockerSrc).toContain(
      "COPY --from=builder /app/src/shared/utils/normalizeEnv.js ./src/shared/utils/normalizeEnv.js",
    );
  });
});
