import { TABLES, buildCreateTableSql } from "../schema.js";
import { QUOTA_V7_TABLES, buildQuotaV7TableSql } from "../migrations/quota-v7-schema.js";
import { isString } from "../../../shared/utils/typeChecks.js";

function tableColumns(db, tableName) {
  const table = db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [tableName]);
  return table ? db.all(`PRAGMA table_info(${tableName})`) : [];
}

/**
 * Verify the published v5 expiry column independently of migration selection.
 * This catches incompatible partial/stamped schemas without ever editing the
 * immutable v5 migration file.
 */
export function verifyApiKeyExpiryColumnLayout(db) {
  const column = tableColumns(db, "apiKeys").find((row) => row.name === "expiresAt");
  if (!column) return;

  const compatible = String(column.type || "").toUpperCase() === "TEXT" &&
  Number(column.notnull || 0) === 0 &&
  Number(column.pk || 0) === 0 &&
  column.dflt_value == null;
  if (!compatible) {
    throw new Error("Published schema mismatch: apiKeys.expiresAt must be nullable TEXT without a default");
  }
}

const QUOTA_V7_TABLE_NAMES = ["providerQuotaSnapshots", "quotaFetchStates"];
const QUOTA_LATEST_TABLE_NAMES = [
...QUOTA_V7_TABLE_NAMES,
"quotaReservations",
"quotaReservationItems"];


/**
 * Tokenize SQLite schema DDL so harmless formatting and identifier quoting do
 * not hide semantic differences. String-literal bytes remain case-sensitive.
 */
export function canonicalizeSchemaSql(sql) {
  if (!isString(sql) || !sql.trim()) throw new Error("Schema SQL must be a non-empty string");
  const tokens = [];
  let index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {index += whitespace[0].length;continue;}
    const lineComment = rest.match(/^--[^\r\n]*(?:\r?\n|$)/);
    if (lineComment) {index += lineComment[0].length;continue;}
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", index + 2);
      if (end < 0) throw new Error("Unterminated SQL comment");
      index = end + 2;
      continue;
    }
    if (rest[0] === "'") {
      let value = "";
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          value += "''";
          index += 2;
        } else if (sql[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          value += sql[index];
          index += 1;
        }
      }
      if (!closed) throw new Error("Unterminated SQL string literal");
      tokens.push(`string:${value}`);
      continue;
    }
    if (rest[0] === '"' || rest[0] === "`" || rest[0] === "[") {
      const opener = rest[0];
      const closer = opener === "[" ? "]" : opener;
      index += 1;
      let value = "";
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === closer) {
          index += 1;
          closed = true;
          break;
        }
        value += sql[index];
        index += 1;
      }
      if (!closed) throw new Error("Unterminated SQL identifier");
      tokens.push(value.toLowerCase());
      continue;
    }
    const word = rest.match(/^[A-Za-z_][A-Za-z0-9_$]*/);
    if (word) {
      tokens.push(word[0].toLowerCase());
      index += word[0].length;
      continue;
    }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      tokens.push(number[0].toLowerCase());
      index += number[0].length;
      continue;
    }
    const operator = rest.match(/^(?:<=|>=|<>|!=|==|\|\||[-+*/%=<>(){},.])/);
    if (operator) {
      tokens.push(operator[0]);
      index += operator[0].length;
      continue;
    }
    if (rest[0] === ";") {index += 1;continue;}
    throw new Error(`Unsupported SQL token at offset ${index}`);
  }

  for (let cursor = 0; cursor <= tokens.length - 3; cursor += 1) {
    if (tokens[cursor] === "if" && tokens[cursor + 1] === "not" && tokens[cursor + 2] === "exists") {
      tokens.splice(cursor, 3);
      cursor -= 1;
    }
  }
  if (tokens[0] === "create") {
    const objectType = tokens[1] === "unique" ? 3 : 2;
    if (tokens[objectType] === "main" && tokens[objectType + 1] === ".") {
      tokens.splice(objectType, 2);
    }
  }
  return tokens.join("\u001f");
}

function expectedIndexName(sql) {
  const match = sql.match(/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i);
  if (!match) throw new Error("Invalid configured quota index SQL");
  const candidate = match[1];
  const pairs = new Map([["`", "`"], ['"', '"'], ["[", "]"]]);
  const closer = pairs.get(candidate[0]);
  return closer && candidate.endsWith(closer) ? candidate.slice(1, -1) : candidate;
}

function quotaSchema(useLatest) {
  return useLatest ?
  {
    definitions: TABLES,
    tableNames: QUOTA_LATEST_TABLE_NAMES,
    buildTableSql: (name) => buildCreateTableSql(name, TABLES[name])
  } :
  {
    definitions: QUOTA_V7_TABLES,
    tableNames: QUOTA_V7_TABLE_NAMES,
    buildTableSql: buildQuotaV7TableSql
  };
}

function verifyQuotaTable(db, tableName, { requireComplete, definitions, buildTableSql }) {
  const definition = definitions[tableName];
  const table = db.get(`SELECT sql FROM sqlite_master WHERE type = 'table' AND lower(name) = lower(?)`, [tableName]);
  if (!table) {
    for (const expectedSql of definition.indexes || []) {
      const name = expectedIndexName(expectedSql);
      const collision = db.get(
        `SELECT 1 AS present FROM sqlite_master WHERE type='index' AND lower(name)=lower(?)`,
        [name]
      );
      if (collision) {
        throw new Error(`Published schema mismatch: ${tableName}.${name} exists without its table`);
      }
    }
    if (requireComplete) throw new Error(`Published schema mismatch: ${tableName} is missing`);
    return;
  }
  const expectedTable = canonicalizeSchemaSql(buildTableSql(tableName));
  if (canonicalizeSchemaSql(table.sql) !== expectedTable) {
    throw new Error(`Published schema mismatch: ${tableName} has incompatible table constraints`);
  }

  const expectedNames = new Set();
  for (const expectedSql of definition.indexes || []) {
    const name = expectedIndexName(expectedSql);
    expectedNames.add(name.toLowerCase());
    const actual = db.get(`SELECT sql FROM sqlite_master WHERE type = 'index' AND lower(name) = lower(?)`, [name]);
    if (!actual) {
      if (requireComplete) throw new Error(`Published schema mismatch: ${tableName}.${name} is missing`);
      continue;
    }
    if (canonicalizeSchemaSql(actual.sql) !== canonicalizeSchemaSql(expectedSql)) {
      throw new Error(`Published schema mismatch: ${tableName}.${name} has an incompatible index definition`);
    }
  }

  for (const indexRow of db.all(`PRAGMA index_list(${tableName})`)) {
    if (Number(indexRow.unique) === 1 && indexRow.origin === "c" && !expectedNames.has(String(indexRow.name).toLowerCase())) {
      throw new Error(`Published schema mismatch: ${tableName} has an unexpected unique index`);
    }
  }
  const triggers = db.all(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND lower(tbl_name) = lower(?)`, [tableName]);
  if (triggers.length > 0) throw new Error(`Published schema mismatch: ${tableName} must not have triggers`);
}

/** Reject incompatible quota objects before mutation and verify completeness after sync. */
export function verifyQuotaStorageLayouts(db, { requireComplete = false, useLatest = false } = {}) {
  const schema = quotaSchema(useLatest);
  for (const tableName of schema.tableNames) verifyQuotaTable(db, tableName, { requireComplete, ...schema });
  const quotaTables = new Set(schema.tableNames.map((tableName) => tableName.toLowerCase()));
  const violations = db.all(`PRAGMA foreign_key_check`).
  filter((row) => quotaTables.has(String(row.table).toLowerCase()));
  if (violations.length > 0) throw new Error("Published schema mismatch: quota storage contains orphan rows");
  if (useLatest) {
    const reservations = db.get(
      `SELECT 1 AS present FROM sqlite_master WHERE type='table' AND lower(name)=lower('quotaReservations')`
    );
    const connections = db.get(
      `SELECT 1 AS present FROM sqlite_master WHERE type='table' AND lower(name)=lower('providerConnections')`
    );
    if (reservations && connections) {
      const mismatch = db.get(
        `SELECT 1 AS present
         FROM quotaReservations r
         JOIN providerConnections c ON c.id=r.connectionId
         WHERE r.provider <> c.provider
         LIMIT 1`
      );
      if (mismatch) {
        throw new Error("Published schema mismatch: quota reservation provider does not match its connection");
      }
    }
  }
}

export function quotaStorageNeedsAdditiveRepair(db, { useLatest = false } = {}) {
  const { definitions, tableNames } = quotaSchema(useLatest);
  for (const tableName of tableNames) {
    const table = db.get(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND lower(name) = lower(?)`, [tableName]);
    if (!table) return true;
    for (const indexSql of definitions[tableName].indexes || []) {
      const name = expectedIndexName(indexSql);
      const index = db.get(`SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND lower(name) = lower(?)`, [name]);
      if (!index) return true;
    }
  }
  return false;
}

/**
 * Run every published-schema layout check (API-key expiry column + quota tables).
 * @param {object} db DB adapter with `get` / `all`
 * @param {{ requireQuotaComplete?: boolean, useLatestQuotaSchema?: boolean }} [opts]
 */
export function verifyPublishedSchemaLayouts(db, { requireQuotaComplete = false, useLatestQuotaSchema = false } = {}) {
  verifyApiKeyExpiryColumnLayout(db);
  verifyQuotaStorageLayouts(db, { requireComplete: requireQuotaComplete, useLatest: useLatestQuotaSchema });
}