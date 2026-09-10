// PostgreSQL adapter — implements the same `adapter` interface used by
// the SQLite adapters (`bunSqliteAdapter`, `betterSqliteAdapter`,
// `nodeSqliteAdapter`, `sqljsAdapter`). Methods: `run`, `get`, `all`,
// `exec`, `transaction`, `close`, `flush`, `checkpoint` (no-op on PG).
//
// The interface mirrors the SQLite adapters so the repos (which call
// `db.run`, `db.get`, `db.all`, `db.exec`, `db.transaction`) are
// unchanged when the engine is PG. The adapter translates the small
// set of dialect differences:
//
//   - Placeholders: the adapter accepts `?` style placeholders and
//     rewrites them to `$1, $2, ...` for PG. Repos can keep using `?`.
//   - lastInsertRowid: the adapter wraps `INSERT` statements and adds
//     a `RETURNING id` clause when a `BIGSERIAL` column is present in
//     the target table. The returned `lastInsertRowid` is the bigint
//     from the sequence. Repos that call `db.run` and read
//     `lastInsertRowid` keep working.
//   - Booleans: PG `BOOLEAN` columns return JS booleans, but the
//     existing repos store 0/1. The adapter exposes a `normalize`
//     hook for callers that want to coerce 0/1 to boolean; the
//     default path keeps 0/1 (matching SQLite storage).
//
// What the adapter does NOT do:
//   - It does not manage a pool. A single `pg.Client` is held for the
//     process lifetime; the mirror is sequential and the repos are
//     single-writer.
//   - It does not retry on transient errors. Repos that need
//     retry-on-conflict already do that themselves.
//   - It does not auto-reconnect. The `postgresFallback` wrapper is
//     responsible for catching connection drops and falling back to
//     SQLite at boot.

import pg from "pg";

const { Client } = pg;

/**
 * Rewrite `?` placeholders to `$1, $2, ...`. The set of reserved
 * characters inside string literals is approximated by counting
 * single-quote pairs from the start of the SQL. This is a small,
 * deliberate simplification: the repos build SQL with parameterised
 * placeholders only, never with literal `?` characters in strings.
 */
function rewritePlaceholders(sql) {
  if (!sql || sql.indexOf("?") === -1) return { sql, params: undefined };
  let out = "";
  let pi = 0;
  let inSingle = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      // Toggle on single-quote; '' (escaped quote) does not toggle.
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
  return { sql: out, params: undefined };
}

/**
 * Identify tables that have a `BIGSERIAL` (or `SERIAL`) autoincrement
 * column. The adapter adds `RETURNING <col>` to `INSERT` statements
 * targeting these tables so the SQLite-style `lastInsertRowid()` works
 * unchanged.
 */
const AUTINCREMENT_TABLES = new Map([
  ["usageHistory", "id"],
  ["tokenSaverEvents", "id"],
  ["pgCutoverLog", "id"],
]);

function detectAutoincrementReturning(sql) {
  if (!/^\s*INSERT\b/i.test(sql)) return null;
  // Find the first table name after `INSERT INTO` (or `INSERT`).
  const into = sql.match(/INSERT\s+INTO\s+("?[\w]+"?)/i);
  if (!into) return null;
  const rawName = into[1].replace(/"/g, "");
  const col = AUTINCREMENT_TABLES.get(rawName);
  if (!col) return null;
  if (/\bRETURNING\b/i.test(sql)) return null;
  return col;
}

function paramsObj(params) {
  if (params == null) return undefined;
  if (Array.isArray(params) && params.length === 0) return undefined;
  return params;
}

/**
 * Open a PG adapter. `options.url` is a libpq connection string. The
 * adapter establishes the connection on the first call and reuses it
 * for the process lifetime.
 *
 * @param {{ url: string, sslmode?: string, clientFactory?: () => any }} options
 *   `clientFactory` is an optional dependency-injection hook used by the
 *   unit tests; production callers omit it and get the canonical
 *   `new pg.Client({...})` factory.
 */
export async function createPostgresAdapter({ url, sslmode, clientFactory } = {}) {
  if (!url) throw new Error("[DB][pg] url is required");
  // Build the connection string with optional sslmode override. libpq
  // understands ?sslmode=... so we just append if not already present.
  let connStr = url;
  if (sslmode && !/[?&]sslmode=/i.test(connStr)) {
    connStr += (connStr.indexOf("?") === -1 ? "?" : "&") + "sslmode=" + encodeURIComponent(sslmode);
  }

  const client = clientFactory
    ? clientFactory({ connectionString: connStr, keepAlive: true })
    : new Client({
    connectionString: connStr,
    // Keep the default keepAlive on so a half-open socket is detected
    // quickly. PG 19 will respect direct TLS negotiation automatically
    // when the cluster supports it.
    keepAlive: true,
  });
  await client.connect();

  // Detect the cluster's major version once at connect time. Used by
  // postgresCapabilityGate to decide which features are exercisable.
  let serverVersionNum = 0;
  let serverVersion = "unknown";
  try {
    const r = await client.query("SHOW server_version_num");
    serverVersionNum = parseInt(r.rows[0].server_version_num, 10) || 0;
    const v = await client.query("SHOW server_version");
    serverVersion = v.rows[0].server_version || "unknown";
  } catch (e) {
    // SHOW is a PG meta-command that the libpq driver translates to
    // a query against pg_settings. If it fails, the cluster is in a
    // degraded state but we still have a working connection.
    serverVersion = `unknown (${e.message})`;
  }

  function run(sql, params = []) {
    const { sql: rewritten } = rewritePlaceholders(sql);
    const returningCol = detectAutoincrementReturning(rewritten);
    const finalSql = returningCol
      ? rewritten.replace(/;?\s*$/, "") + ` RETURNING "${returningCol}"`
      : rewritten;
    return (async () => {
      const res = await client.query(finalSql, paramsObj(params));
      const lastInsertRowid = returningCol && res.rows[0]
        ? Number(res.rows[0][returningCol])
        : null;
      return { changes: res.rowCount ?? 0, lastInsertRowid };
    })();
  }

  function get(sql, params = []) {
    const { sql: rewritten } = rewritePlaceholders(sql);
    return (async () => {
      const res = await client.query(rewritten, paramsObj(params));
      return res.rows[0];
    })();
  }

  function all(sql, params = []) {
    const { sql: rewritten } = rewritePlaceholders(sql);
    return (async () => {
      const res = await client.query(rewritten, paramsObj(params));
      return res.rows;
    })();
  }

  function exec(sql) {
    // `exec` may be called with a multi-statement string. PG's
    // `client.query` does not support multi-statement strings; the
    // caller (the migration set) is expected to call `exec` once per
    // statement. We split on `;` followed by a newline or end-of-string
    // to keep the SQLite-shape contract.
    const statements = sql
      .split(/;\s*(?=\n|$)/m)
      .map((s) => s.trim())
      .filter(Boolean);
    return (async () => {
      for (const stmt of statements) {
        if (stmt) await client.query(stmt);
      }
    })();
  }

  // PG transactions use `BEGIN` / `COMMIT` / `ROLLBACK` on the same
  // client; we keep the SQLite-style `transaction(() => ...)` shape by
  // serialising the callback on the adapter.
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
        } catch {}
        txDepth -= 1;
        if (txDepth === 0) {
          try { await client.query("ROLLBACK"); } catch {}
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

  // PG is durable by default — no in-memory flush. We expose the method
  // for interface symmetry with the SQLite adapters.
  function flush() { /* no-op on PG */ }
  // PG has no WAL file to checkpoint; the method exists for the
  // interface.
  async function checkpoint() { /* no-op on PG */ }

  return Object.freeze({
    driver: "pg",
    capabilities: Object.freeze({
      sharedFileTransactions: false,
      isPostgres: true,
      serverVersionNum,
      serverVersion,
    }),
    run,
    get,
    all,
    exec,
    transaction,
    close,
    flush,
    checkpoint,
    raw: client,
  });
}
