// PostgreSQL adapter — same `adapter` interface as the SQLite adapters
// (`run`, `get`, `all`, `exec`, `transaction`, `close`, `flush`,
// `checkpoint`). Repos stay unchanged: they call those methods
// synchronously, the way better-sqlite3 does.
//
// Production path: a worker thread owns a `pg.Pool` (max 1) and the
// parent blocks on `Atomics.wait` for each query. That matches the
// existing SQLite contract (the event loop already blocks on
// better-sqlite3). Tests inject `clientFactory` and stay async.
//
// Dialect translations the adapter owns:
//   - SQLite DML (`INSERT OR IGNORE`, `datetime('now')`, `COLLATE NOCASE`)
//   - `?` placeholders → `$1, $2, ...`
//   - `RETURNING` on known BIGSERIAL tables so `lastInsertRowid` works

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { rewriteSqliteDml } from "../dialects/postgres/dmlRewrite.js";
import { isFunction } from "../../../shared/utils/typeChecks.js";

const { Client } = pg;

// The async client path must agree with the synchronous worker and SQLite.
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);

const AUTINCREMENT_TABLES = new Map([
  ["usageHistory", "id"],
  ["tokenSaverEvents", "id"],
  ["pgCutoverLog", "id"],
]);

// Resolved lazily: webpack rewrites `import.meta.url` when it bundles this
// module, and `fileURLToPath` then rejects the value it produces. At module
// scope that turns a mere import into a build-time crash ("Failed to collect
// page data"), even for routes that never open a PG connection. Resolving on
// first use keeps the failure inside the call that actually needs a worker.
let workerPath = null;
function resolveWorkerPath() {
  if (workerPath) return workerPath;
  workerPath = fileURLToPath(new URL("./pgSyncWorker.cjs", import.meta.url));
  return workerPath;
}
const SAB_BYTES = 8 * 1024 * 1024;
const HEADER_BYTES = 8;
const WAIT_MS = 120_000;

function rewritePlaceholders(sql) {
  if (!sql || sql.indexOf("?") === -1) return sql;
  let out = "";
  let pi = 0;
  let inSingle = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      if (inSingle && sql[i + 1] === "'") {
        out += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (ch === "?" && !inSingle) {
      pi += 1;
      out += `$${pi}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function detectAutoincrementReturning(sql) {
  if (!/^\s*INSERT\b/i.test(sql)) return null;
  const into = sql.match(/INSERT\s+INTO\s+("?[\w]+"?)/i);
  if (!into) return null;
  const rawName = into[1].replace(/"/g, "");
  const col = AUTINCREMENT_TABLES.get(rawName);
  if (!col) return null;
  if (/\bRETURNING\b/i.test(sql)) return null;
  return col;
}

function prepareSql(sql) {
  const rewrittenDml = rewriteSqliteDml(sql);
  const rewritten = rewritePlaceholders(rewrittenDml);
  const returningCol = detectAutoincrementReturning(rewritten);
  const finalSql = returningCol
    ? rewritten.replace(/;?\s*$/, "") + ` RETURNING "${returningCol}"`
    : rewritten;
  return { finalSql, returningCol };
}

function paramsObj(params) {
  if (params == null) return undefined;
  if (Array.isArray(params) && params.length === 0) return undefined;
  return params;
}

function sanitizePgError(err) {
  const message = String(err && err.message || err)
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://***");
  const out = new Error(message);
  if (err && err.code) out.code = err.code;
  return out;
}

function appendSslmode(url, sslmode) {
  const mode = sslmode || process.env.DURINDOOR_PG_SSLMODE;
  if (!mode) return url;
  if (/[?&]sslmode=/i.test(url)) return url;
  return url + (url.indexOf("?") === -1 ? "?" : "&") + "sslmode=" + encodeURIComponent(mode);
}

function createSyncBridge(url) {
  const sab = new SharedArrayBuffer(SAB_BYTES);
  const i32 = new Int32Array(sab, 0, 2);
  const worker = new Worker(resolveWorkerPath(), { workerData: { url, sab } });
  let closed = false;

  function call(msg) {
    if (closed) throw new Error("[DB][pg] adapter is closed");
    Atomics.store(i32, 0, 0);
    worker.postMessage(msg);
    const rc = Atomics.wait(i32, 0, 0, WAIT_MS);
    if (rc === "timed-out") {
      throw new Error("[DB][pg] query timed out");
    }
    const status = Atomics.load(i32, 0);
    const len = Atomics.load(i32, 1);
    const json = Buffer.from(sab, HEADER_BYTES, len).toString("utf8");
    const parsed = json ? JSON.parse(json) : {};
    if (status !== 1) {
      throw sanitizePgError(parsed);
    }
    return parsed;
  }

  return {
    query(sql, params) {
      return call({ op: "query", sql, params: paramsObj(params) || [] });
    },
    exec(sql) {
      return call({ op: "exec", sql });
    },
    begin() {
      return call({ op: "begin" });
    },
    commit() {
      return call({ op: "commit" });
    },
    rollback() {
      return call({ op: "rollback" });
    },
    async close() {
      if (closed) return;
      closed = true;
      try { call({ op: "close" }); } catch { /* noop */ }
      try { await worker.terminate(); } catch { /* noop */ }
    },
  };
}

function mapRunResult(res, returningCol) {
  const lastInsertRowid = returningCol && res.rows && res.rows[0]
    ? Number(res.rows[0][returningCol])
    : null;
  return { changes: res.rowCount ?? 0, lastInsertRowid };
}

function capabilitiesOf(serverVersionNum, serverVersion) {
  return Object.freeze({
    // Real transactions exist; quota reservations take a FOR UPDATE lock.
    sharedFileTransactions: true,
    isPostgres: true,
    serverVersionNum,
    serverVersion,
  });
}

async function readServerVersion(queryFn) {
  let serverVersionNum = 0;
  let serverVersion = "unknown";
  try {
    const r = await queryFn("SHOW server_version_num");
    const row = r.rows && r.rows[0];
    serverVersionNum = parseInt(row && row.server_version_num, 10) || 0;
    const v = await queryFn("SHOW server_version");
    const vrow = v.rows && v.rows[0];
    serverVersion = (vrow && vrow.server_version) || "unknown";
  } catch (e) {
    serverVersion = `unknown (${e.message})`;
  }
  return { serverVersionNum, serverVersion };
}

/**
 * Open a PG adapter. `options.url` is a libpq connection string.
 *
 * @param {{ url: string, sslmode?: string, clientFactory?: () => any }} options
 *   `clientFactory` is the unit-test seam (async `pg.Client` mock).
 *   Production omits it and uses the sync worker bridge.
 */
export async function createPostgresAdapter({ url, sslmode, clientFactory } = {}) {
  if (!url) throw new Error("[DB][pg] url is required");
  const connStr = appendSslmode(url, sslmode);

  if (clientFactory) {
    return createAsyncAdapter(connStr, clientFactory);
  }
  return createSyncAdapter(connStr);
}

async function createSyncAdapter(connStr) {
  const bridge = createSyncBridge(connStr);
  const { serverVersionNum, serverVersion } = await readServerVersion(async (sql) =>
    bridge.query(sql)
  );

  let txDepth = 0;

  function run(sql, params = []) {
    const { finalSql, returningCol } = prepareSql(sql);
    const res = bridge.query(finalSql, params);
    return mapRunResult(res, returningCol);
  }

  function get(sql, params = []) {
    const { finalSql } = prepareSql(sql);
    const res = bridge.query(finalSql, params);
    return res.rows[0];
  }

  function all(sql, params = []) {
    const { finalSql } = prepareSql(sql);
    const res = bridge.query(finalSql, params);
    return res.rows;
  }

  function exec(sql) {
    const rewritten = rewriteSqliteDml(sql);
    bridge.exec(rewritten);
  }

  function transaction(fn) {
    const nested = txDepth > 0;
    if (!nested) bridge.begin();
    txDepth += 1;
    try {
      const result = fn();
      if (result && isFunction(result.then)) {
        txDepth -= 1;
        if (!nested) {
          try { bridge.rollback(); } catch { /* noop */ }
        }
        throw new Error("[DB][pg] transaction callback must be synchronous");
      }
      txDepth -= 1;
      if (!nested) bridge.commit();
      return result;
    } catch (e) {
      txDepth -= 1;
      if (!nested) {
        try { bridge.rollback(); } catch { /* noop */ }
      }
      throw e;
    }
  }

  return Object.freeze({
    driver: "pg",
    capabilities: capabilitiesOf(serverVersionNum, serverVersion),
    run,
    get,
    all,
    exec,
    transaction,
    close: () => bridge.close(),
    flush() { /* durable */ },
    async checkpoint() { /* no WAL */ },
    raw: null,
  });
}

async function createAsyncAdapter(connStr, clientFactory) {
  const client = clientFactory
    ? clientFactory({ connectionString: connStr, keepAlive: true })
    : new Client({ connectionString: connStr, keepAlive: true });
  await client.connect();

  const { serverVersionNum, serverVersion } = await readServerVersion((sql) =>
    client.query(sql)
  );

  function run(sql, params = []) {
    const { finalSql, returningCol } = prepareSql(sql);
    return (async () => {
      const res = await client.query(finalSql, paramsObj(params));
      return mapRunResult(res, returningCol);
    })();
  }

  function get(sql, params = []) {
    const { finalSql } = prepareSql(sql);
    return (async () => {
      const res = await client.query(finalSql, paramsObj(params));
      return res.rows[0];
    })();
  }

  function all(sql, params = []) {
    const { finalSql } = prepareSql(sql);
    return (async () => {
      const res = await client.query(finalSql, paramsObj(params));
      return res.rows;
    })();
  }

  function exec(sql) {
    const rewritten = rewriteSqliteDml(sql);
    const statements = rewritten
      .split(/;\s*(?=\n|$)/m)
      .map((s) => s.trim())
      .filter(Boolean);
    return (async () => {
      for (const stmt of statements) {
        if (stmt) await client.query(stmt);
      }
    })();
  }

  let txDepth = 0;
  function transaction(fn) {
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    return (async () => {
      if (txDepth === 0) await client.query("BEGIN");
      txDepth += 1;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        const result = await fn();
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        txDepth -= 1;
        if (txDepth === 0) await client.query("COMMIT");
        return result;
      } catch (e) {
        try {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          await client.query(`RELEASE SAVEPOINT ${sp}`);
        } catch { /* noop */ }
        txDepth -= 1;
        if (txDepth === 0) {
          try { await client.query("ROLLBACK"); } catch { /* noop */ }
        }
        throw e;
      }
    })();
  }

  async function close() {
    if (client && !client._ending) {
      client._ending = true;
      try { await client.end(); } catch { /* idempotent */ }
    }
  }

  return Object.freeze({
    driver: "pg",
    capabilities: capabilitiesOf(serverVersionNum, serverVersion),
    run,
    get,
    all,
    exec,
    transaction,
    close,
    flush() { /* no-op */ },
    async checkpoint() { /* no-op */ },
    raw: client,
  });
}

export { rewritePlaceholders, prepareSql, appendSslmode };
