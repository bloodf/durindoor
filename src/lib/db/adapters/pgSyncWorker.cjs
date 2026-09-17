"use strict";
// PostgreSQL query worker. The parent adapter blocks on Atomics.wait so
// get/run/all stay synchronous like better-sqlite3. One Pool (max 1) so a
// dropped socket is replaced; transactions check out the only client.

const { parentPort, workerData } = require("node:worker_threads");
const pg = require("pg");

const STATUS = 0;
const LENGTH = 1;
const HEADER_BYTES = 8;

const sab = workerData.sab;
const i32 = new Int32Array(sab, 0, 2);
const payload = Buffer.from(sab);

function sanitize(message) {
  return String(message || "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://***");
}

function reply(ok, data) {
  const json = Buffer.from(JSON.stringify(data), "utf8");
  if (HEADER_BYTES + json.length > sab.byteLength) {
    const tooBig = Buffer.from(JSON.stringify({
      message: `PG result too large for sync bridge (${json.length} bytes)`,
    }), "utf8");
    tooBig.copy(payload, HEADER_BYTES);
    Atomics.store(i32, LENGTH, tooBig.length);
    Atomics.store(i32, STATUS, 2);
    Atomics.notify(i32, STATUS);
    return;
  }
  json.copy(payload, HEADER_BYTES);
  Atomics.store(i32, LENGTH, json.length);
  Atomics.store(i32, STATUS, ok ? 1 : 2);
  Atomics.notify(i32, STATUS);
}

let pool = null;
let txClient = null;

async function ensurePool() {
  if (pool) return pool;
  pool = new pg.Pool({
    connectionString: workerData.url,
    max: 1,
    keepAlive: true,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  pool.on("error", () => {
    // Idle-client errors must not crash the worker. Next query opens a new client.
  });
  return pool;
}

async function handle(msg) {
  const op = msg && msg.op;
  if (op === "close") {
    if (txClient) {
      try { txClient.release(true); } catch { /* noop */ }
      txClient = null;
    }
    if (pool) {
      try { await pool.end(); } catch { /* noop */ }
      pool = null;
    }
    return { ok: true };
  }

  const db = await ensurePool();
  if (op === "begin") {
    if (txClient) throw new Error("PG transaction already open");
    txClient = await db.connect();
    await txClient.query("BEGIN");
    return { ok: true };
  }
  if (op === "commit") {
    if (!txClient) throw new Error("PG commit without transaction");
    try {
      await txClient.query("COMMIT");
    } finally {
      try { txClient.release(); } catch { /* noop */ }
      txClient = null;
    }
    return { ok: true };
  }
  if (op === "rollback") {
    if (!txClient) return { ok: true };
    try {
      await txClient.query("ROLLBACK");
    } finally {
      try { txClient.release(true); } catch { /* noop */ }
      txClient = null;
    }
    return { ok: true };
  }
  if (op === "query") {
    const client = txClient || db;
    const res = await client.query(msg.sql, msg.params || []);
    return { rows: res.rows || [], rowCount: res.rowCount ?? 0 };
  }
  if (op === "exec") {
    const client = txClient || db;
    const statements = String(msg.sql || "")
      .split(/;\s*(?=\n|$)/m)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await client.query(stmt);
    }
    return { ok: true };
  }
  throw new Error(`unknown pg worker op: ${op}`);
}

parentPort.on("message", async (msg) => {
  try {
    const result = await handle(msg);
    reply(true, result);
  } catch (err) {
    reply(false, { message: sanitize(err && err.message), code: err && err.code });
  }
});
