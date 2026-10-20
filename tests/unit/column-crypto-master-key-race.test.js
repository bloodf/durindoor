// Regression: two processes minting the master key on first start must agree on
// one key. loadMasterKey used a non-exclusive write, so both processes saw
// ENOENT, each generated a key, and the loser's ciphertexts became undecryptable.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
let workDir;
let bundle;
let dbBundle;
let preload;

// Preload: after a process's first ENOENT read of master-key, announce it and
// block until every peer has also seen ENOENT. Guarantees both processes take
// the "absent" branch before either publishes a key.
const PRELOAD = `
const fs = require("node:fs");
const path = require("node:path");
const barrier = process.env.TEST_BARRIER_DIR;
const peers = Number(process.env.TEST_BARRIER_PEERS || 0);
const orig = fs.readFileSync;
let passed = !barrier;
fs.readFileSync = function (p, ...rest) {
  try {
    return orig.call(this, p, ...rest);
  } catch (err) {
    if (!passed && err && err.code === "ENOENT" && path.basename(String(p)) === "master-key") {
      passed = true;
      fs.writeFileSync(path.join(barrier, process.pid + ".ready"), "");
      const sleep = new Int32Array(new SharedArrayBuffer(4));
      const deadline = Date.now() + 15000;
      while (fs.readdirSync(barrier).length < peers) {
        if (Date.now() > deadline) throw new Error("barrier timeout");
        Atomics.wait(sleep, 0, 0, 5);
      }
    }
    throw err;
  }
};
`;

const ENTRY = `
import { encryptField, decryptField } from "@/lib/crypto/columnCrypto.js";
const [mode, arg] = process.argv.slice(2);
if (mode === "encrypt") {
  process.stdout.write(JSON.stringify(encryptField(arg, "row-" + arg)));
} else {
  process.stdout.write(decryptField(JSON.parse(arg), "row-" + process.argv[4]));
}
`;

const DB_ENTRY = `
import { createProviderConnection, getProviderConnectionById } from "@/lib/db/repos/connectionsRepo.js";
import { getAdapter } from "@/lib/db/driver.js";
console.log = (...args) => console.error(...args);
(async () => {
  const [mode, arg] = process.argv.slice(2);
  const db = await getAdapter();
  try {
    const connection = mode === "create"
      ? await createProviderConnection({
          provider: "openai", authType: "apikey", name: "restart-proof", apiKey: arg
        })
      : await getProviderConnectionById(arg);
    const row = db.get("SELECT data FROM providerConnections WHERE id = ?", [connection.id]);
    process.stdout.write(JSON.stringify({ id: connection.id, apiKey: connection.apiKey, stored: JSON.parse(row.data).apiKey }));
  } finally {
    await db.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;

function run(args, env, childBundle = bundle) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-r", preload, childBundle, ...args], {
      env: childBundle === bundle ? { ...process.env, ...env } : env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-race-"));
  bundle = path.join(workDir, "child.cjs");
  preload = path.join(workDir, "preload.cjs");
  fs.writeFileSync(preload, PRELOAD);
  await build({
    stdin: { contents: ENTRY, resolveDir: srcDir, loader: "js" },
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    alias: { "@": srcDir },
    logLevel: "silent"
  });
});

afterAll(() => {
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

describe("columnCrypto first-start master key race", () => {
  it("concurrent first starts converge on one key; both ciphertexts decrypt after restart", async () => {
    const dataDir = path.join(workDir, "race-data");
    const barrier = path.join(workDir, "race-barrier");
    fs.mkdirSync(dataDir);
    fs.mkdirSync(barrier);
    const env = { DATA_DIR: dataDir, TEST_BARRIER_DIR: barrier, TEST_BARRIER_PEERS: "2" };

    const [a, b] = await Promise.all([
      run(["encrypt", "alpha"], env),
      run(["encrypt", "beta"], env)
    ]);
    expect(a.stderr).toBe("");
    expect(b.stderr).toBe("");
    expect([a.code, b.code]).toEqual([0, 0]);
    // Both really took the absent branch.
    expect(fs.readdirSync(barrier)).toHaveLength(2);

    // "Restart": fresh processes, no barrier.
    const plain = { DATA_DIR: dataDir };
    const da = await run(["decrypt", a.stdout, "alpha"], plain);
    const db = await run(["decrypt", b.stdout, "beta"], plain);
    expect(da.stderr).toBe("");
    expect(da.stdout).toBe("alpha");
    expect(db.stderr).toBe("");
    expect(db.stdout).toBe("beta");

    // Exactly one full key, private, and no stray temp files.
    expect(fs.readdirSync(dataDir)).toEqual(["master-key"]);
    const keyPath = path.join(dataDir, "master-key");
    const stat = fs.statSync(keyPath);
    expect(stat.size).toBe(32);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  }, 60_000);

  it("decrypts a persisted connection row after process restart without changing the master key", async () => {
    const dataDir = path.join(workDir, "row-restart-data");
    fs.mkdirSync(dataDir);
    dbBundle = path.join(workDir, "db-child.cjs");
    // Bundle ESM dependencies; keep SQLite drivers and their assets installed.
    await build({
      stdin: { contents: DB_ENTRY, resolveDir: srcDir, loader: "js" },
      outfile: dbBundle,
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["better-sqlite3", "sql.js", "bun:sqlite", "node:sqlite", "pg"],
      alias: { "@": srcDir, "open-sse": path.resolve(srcDir, "../open-sse") },
      banner: { js: `require = require("node:module").createRequire(${JSON.stringify(path.resolve(srcDir, "../package.json"))});` },
      logLevel: "silent"
    });
    const env = { PATH: process.env.PATH, HOME: dataDir, DATA_DIR: dataDir, DURINDOOR_DATABASE_ENGINE: "sqlite" };
    const secret = "sk-isolated-row-restart-proof";
    const created = await run(["create", secret], env, dbBundle);
    expect(created.code, created.stderr).toBe(0);
    const original = JSON.parse(created.stdout);
    expect(original.apiKey).toBe(secret);
    expect(original.stored).toEqual({ v: 1, iv: expect.any(String), ct: expect.any(String) });
    expect(JSON.stringify(original.stored)).not.toContain(secret);

    const keyPath = path.join(dataDir, "master-key");
    const key = fs.readFileSync(keyPath);
    expect(key.length).toBe(32);
    // An old timestamp makes even a same-bytes rewrite observable on coarse filesystems.
    const past = new Date(Date.now() - 3_600_000);
    fs.utimesSync(keyPath, past, past);
    const before = fs.statSync(keyPath);
    if (process.platform !== "win32") {
      expect(before.mode & 0o777).toBe(0o600);
      expect(fs.statSync(dataDir).mode & 0o777).toBe(0o700);
    }

    const reopened = await run(["read", original.id], env, dbBundle);
    expect(reopened.code, reopened.stderr).toBe(0);
    expect(JSON.parse(reopened.stdout)).toEqual(original);
    const after = fs.statSync(keyPath);
    expect(after.size).toBe(32);
    expect(fs.readFileSync(keyPath)).toEqual(key);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    if (process.platform !== "win32") {
      expect(after.mode & 0o777).toBe(0o600);
      expect(fs.statSync(dataDir).mode & 0o777).toBe(0o700);
    }
  }, 60_000);

  it("leaves an existing valid key's bytes and mtime untouched", async () => {
    const dataDir = path.join(workDir, "existing-data");
    fs.mkdirSync(dataDir);
    const keyPath = path.join(dataDir, "master-key");
    const key = Buffer.alloc(32, 7);
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    const past = new Date(Date.now() - 3_600_000);
    fs.utimesSync(keyPath, past, past);
    const before = fs.statSync(keyPath);

    const [a, b] = await Promise.all([
      run(["encrypt", "alpha"], { DATA_DIR: dataDir }),
      run(["encrypt", "beta"], { DATA_DIR: dataDir })
    ]);
    expect([a.code, b.code]).toEqual([0, 0]);

    const after = fs.statSync(keyPath);
    expect(fs.readFileSync(keyPath).equals(key)).toBe(true);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(fs.readdirSync(dataDir)).toEqual(["master-key"]);
  }, 60_000);

  it.each([["empty", 0], ["short", 5]])(
    "rejects a %s existing key without rotating it",
    async (_name, size) => {
      const dataDir = path.join(workDir, `bad-${size}-data`);
      fs.mkdirSync(dataDir);
      const keyPath = path.join(dataDir, "master-key");
      const bad = Buffer.alloc(size, 9);
      fs.writeFileSync(keyPath, bad, { mode: 0o600 });

      const r = await run(["encrypt", "alpha"], { DATA_DIR: dataDir });
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain("must be exactly 32 bytes");
      expect(fs.readFileSync(keyPath).equals(bad)).toBe(true);
      expect(fs.readdirSync(dataDir)).toEqual(["master-key"]);
    },
    60_000
  );
});
