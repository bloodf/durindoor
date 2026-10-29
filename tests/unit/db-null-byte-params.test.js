// Regression: SQLite binds TEXT as a NUL-terminated C string, so a bound
// string with an embedded NUL cannot survive the write.
//
//  - better-sqlite3 rejects it: "TypeError: String contains null byte",
//    which aborts the write and with it the background flush worker.
//  - node:sqlite accepts it and silently keeps only the prefix before the
//    NUL — the rest of the value is gone with no trace.
//  - PostgreSQL TEXT rejects embedded NUL bytes.
//
// Telemetry carries values that can contain one: a model id or endpoint taken
// straight from the request, raw bytes out of a tool result, a diff. The write
// must survive and must keep the whole value. (#1358 / upstream 5a4e812)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { stripNullBytes, withNullByteSafeParams } from "@/lib/db/helpers/nullBytes.js";

// Built at runtime so the source file itself holds no literal NUL byte.
const NUL = String.fromCharCode(0);
const DIRTY = `before${NUL}after`;
const CLEAN = "beforeafter";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-nul-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  // driver.js captures the shared state object at module load, so the module
  // has to be re-imported for each test to get a fresh (open) database.
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("stripNullBytes", () => {
  it("removes NUL bytes and keeps the rest of the text", () => {
    expect(stripNullBytes(DIRTY)).toEqual(CLEAN);
    expect(stripNullBytes(`a${NUL}b${NUL}c`)).toEqual("abc");
  });

  it("leaves clean strings byte-identical (same reference)", () => {
    const plain = "plain text";
    expect(stripNullBytes(plain)).toEqual(plain);
    expect(stripNullBytes(plain)).toBe(plain);
    const empty = "";
    expect(stripNullBytes(empty)).toEqual(empty);
    expect(stripNullBytes(empty)).toBe(empty);
  });

  it("passes non-string values through unchanged (same reference)", () => {
    expect(stripNullBytes(null)).toEqual(null);
    expect(stripNullBytes(undefined)).toEqual(undefined);
    expect(stripNullBytes(42)).toEqual(42);
    expect(stripNullBytes(0)).toEqual(0);
    expect(stripNullBytes(true)).toEqual(true);
    expect(stripNullBytes(false)).toEqual(false);
    const buf = Buffer.from([0, 1, 2]);
    expect(stripNullBytes(buf)).toEqual(buf);
    expect(stripNullBytes(buf)).toBe(buf);
    const arr = new Uint8Array([0, 9]);
    expect(stripNullBytes(arr)).toBe(arr);
  });

  it("does not mutate the caller string", () => {
    const input = `x${NUL}y`;
    const out = stripNullBytes(input);
    expect(out).toEqual("xy");
    expect(input).toEqual(`x${NUL}y`);
    expect(out).not.toBe(input);
  });
});

describe("withNullByteSafeParams", () => {
  it("strips only string array elements and leaves the caller array untouched", async () => {
    const seen = [];
    const raw = {
      driver: "mock",
      run(sql, params) { seen.push({ op: "run", sql, params }); return { changes: 1 }; },
      get(sql, params) { seen.push({ op: "get", sql, params }); return { label: params?.[0] }; },
      all(sql, params) { seen.push({ op: "all", sql, params }); return [{ label: params?.[0] }]; },
    };
    const adapter = withNullByteSafeParams(raw);
    const buf = Buffer.from([0, 1]);
    const params = [DIRTY, 7, null, undefined, true, false, buf, CLEAN];
    adapter.run("INSERT", params);
    expect(params).toEqual([DIRTY, 7, null, undefined, true, false, buf, CLEAN]);
    expect(seen[0].params).toEqual([CLEAN, 7, null, undefined, true, false, buf, CLEAN]);
    expect(seen[0].params[6]).toBe(buf);
    expect(seen[0].params).not.toBe(params);

    adapter.get("SELECT", [DIRTY]);
    adapter.all("SELECT", [DIRTY]);
    expect(seen[1].params).toEqual([CLEAN]);
    expect(seen[2].params).toEqual([CLEAN]);
  });

  it("passes non-array params through unchanged", () => {
    const seen = [];
    const raw = {
      run(_sql, params) { seen.push(params); },
      get() {},
      all() {},
    };
    const adapter = withNullByteSafeParams(raw);
    const named = { $label: DIRTY };
    adapter.run("SELECT", named);
    expect(seen[0]).toBe(named);
    expect(named.$label).toEqual(DIRTY);
  });

  it("is idempotent and preserves driver identity methods", () => {
    const raw = {
      driver: "pg",
      capabilities: { isPostgres: true },
      run() {},
      get() {},
      all() {},
      exec() {},
      transaction() {},
    };
    const once = withNullByteSafeParams(raw);
    const twice = withNullByteSafeParams(once);
    expect(twice).toBe(once);
    expect(once.driver).toEqual("pg");
    expect(typeof once.exec).toEqual("function");
    expect(typeof once.transaction).toEqual("function");
  });
});

describe("postgres adapter bind boundary", () => {
  it("strips NUL from params before the PG client sees them", async () => {
    const { createPostgresAdapter } = await import("@/lib/db/adapters/pgAdapter.js");
    const calls = [];
    const client = {
      async connect() {},
      async end() {},
      async query(sql, params) {
        calls.push({ sql, params });
        if (String(sql).includes("server_version")) {
          return { rows: [{ server_version_num: "160000", server_version: "16.0" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const raw = await createPostgresAdapter({
      url: "postgres://u@h/db",
      clientFactory: () => client,
    });
    const adapter = withNullByteSafeParams(raw);
    await adapter.run("INSERT INTO nulTest(label) VALUES (?)", [DIRTY]);
    const insert = calls.find((c) => /INSERT INTO "?nulTest"?/i.test(c.sql));
    expect(insert.params).toEqual([CLEAN]);
  });
});

describe("driver binds NUL-containing strings safely", () => {
  it("stores the whole value instead of throwing or truncating", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    db.run("CREATE TABLE IF NOT EXISTS nulTest (id INTEGER PRIMARY KEY, label TEXT)");

    expect(() => db.run("INSERT INTO nulTest (label) VALUES (?)", [DIRTY])).not.toThrow();

    const row = db.get("SELECT label FROM nulTest");
    expect(row.label).toEqual(CLEAN);
  });

  it("keeps a NUL out of a lookup value too", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    db.run("CREATE TABLE IF NOT EXISTS nulLookup (id INTEGER PRIMARY KEY, label TEXT)");
    db.run("INSERT INTO nulLookup (label) VALUES (?)", [DIRTY]);

    const row = db.get("SELECT label FROM nulLookup WHERE label = ?", [DIRTY]);
    expect(row?.label).toEqual(CLEAN);
  });

  it("leaves numbers, null, buffers and clean strings byte-identical through run", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run("CREATE TABLE IF NOT EXISTS nulTypes (id INTEGER PRIMARY KEY, n INTEGER, s TEXT, b BLOB, flag INTEGER)");
    const buf = Buffer.from([0, 1, 2, 3]);
    db.run("INSERT INTO nulTypes (n, s, b, flag) VALUES (?, ?, ?, ?)", [42, "ok", buf, 1]);
    const row = db.get("SELECT n, s, b, flag FROM nulTypes");
    expect(row.n).toEqual(42);
    expect(row.s).toEqual("ok");
    expect(Buffer.from(row.b)).toEqual(buf);
    expect(row.flag).toEqual(1);
  });

  it("leaves the driver identity and the other methods intact", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    expect(["better-sqlite3", "node:sqlite", "sql.js", "bun:sqlite"]).toContain(db.driver);
    expect(typeof db.exec).toEqual("function");
    expect(typeof db.transaction).toEqual("function");
  });
});

describe("usage / request-detail write path with embedded NUL", () => {
  it("saves usage with a NUL in model and endpoint, then reads the stripped values", async () => {
    await import("@/lib/db/index.js");
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const ok = await saveRequestUsage({
      timestamp: "2026-10-29T12:00:00.000Z",
      provider: "test-provider",
      model: `model${NUL}id`,
      endpoint: `/v1/chat${NUL}/completions`,
      tokens: { prompt_tokens: 1, completion_tokens: 2 },
      status: "ok",
      usageEventId: "nul-usage-event",
      strict: true,
    });
    expect(ok).toEqual(true);

    const row = db.get(
      `SELECT model, endpoint FROM usageHistory WHERE usageEventId = ?`,
      ["nul-usage-event"]
    );
    expect(row).toEqual({ model: "modelid", endpoint: "/v1/chat/completions" });
  });

  it("flushes a request-detail row whose model contains NUL", async () => {
    const previousEnabled = process.env.OBSERVABILITY_ENABLED;
    process.env.OBSERVABILITY_ENABLED = "true";
    try {
      await import("@/lib/db/index.js");
      const { getAdapter } = await import("@/lib/db/driver.js");
      const db = await getAdapter();
      const { updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
      // Batch size 1 forces an immediate flush on the first saveRequestDetail.
      await updateSettings({
        enableObservability: true,
        observabilityBatchSize: 1,
        observabilityFlushIntervalMs: 10,
      });
      const { saveRequestDetail } = await import("@/lib/db/repos/requestDetailsRepo.js");

      await saveRequestDetail({
        id: "nul-detail-1",
        provider: "test-provider",
        model: `claude${NUL}sonnet`,
        status: "ok",
        timestamp: "2026-10-29T12:00:00.000Z",
      });

      await expect.poll(() => {
        const row = db.get(`SELECT model FROM requestDetails WHERE id = ?`, ["nul-detail-1"]);
        return row?.model;
      }).toEqual("claudesonnet");
    } finally {
      if (previousEnabled === undefined) delete process.env.OBSERVABILITY_ENABLED;
      else process.env.OBSERVABILITY_ENABLED = previousEnabled;
    }
  });
});
