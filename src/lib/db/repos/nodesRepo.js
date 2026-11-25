import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { deleteProviderConnectionsByProviderInTx } from "./connectionsRepo.js";
import { isString } from "../../../shared/utils/typeChecks.js";
import { assertValidProviderNode } from "../../providerNodes/validateNode.js";

function rowToNode(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function nodeToRow(n) {
  const { id, type, name, createdAt, updatedAt, ...rest } = n;
  return {
    id,
    type: type ?? null,
    name: name ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt
  };
}

function upsert(db, n) {
  const r = nodeToRow(n);
  db.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.type, r.name, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProviderNodes(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.type) {where.push("type = ?");params.push(filter.type);}
  const sql = `SELECT * FROM providerNodes${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  return db.all(sql, params).map(rowToNode);
}

export async function getProviderNodeById(id) {
  const db = await getAdapter();
  return rowToNode(db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]));
}

export async function createProviderNode(data) {
  const checked = assertValidProviderNode(data, { type: data.type });
  const db = await getAdapter();
  const now = new Date().toISOString();
  const node = {
    id: data.id || uuidv4(),
    type: data.type,
    name: checked.name ?? data.name,
    prefix: checked.prefix ?? data.prefix,
    apiType: checked.apiType ?? data.apiType,
    baseUrl: checked.baseUrl ?? data.baseUrl,
    ...(checked.iconUrl ? { iconUrl: checked.iconUrl } : null),
    createdAt: now,
    updatedAt: now
  };
  // Insert-only: a caller-chosen ID must never overwrite an existing node (#4710).
  const row = nodeToRow(node);
  const result = db.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [row.id, row.type, row.name, row.data, row.createdAt, row.updatedAt]
  );
  if ((result?.changes ?? 0) === 0) {
    const error = new Error(`Provider node ID "${node.id}" already exists`);
    error.code = "PROVIDER_NODE_ID_CONFLICT";
    throw error;
  }
  return node;
}

// A mutable prefix only belongs to a node while no other node or built-in uses it.
function ownsPrefix(db, node, prefix) {
  return Boolean(prefix) && !REGISTRY.some((p) => [p.id, p.alias, p.uiAlias, ...(p.aliases || [])].includes(prefix)) &&
    !db.all(`SELECT * FROM providerNodes`).some((row) => row.id !== node.id && (row.id === prefix || rowToNode(row).prefix === prefix));
}

function rewriteOwnedAliases(db, prefix, replacement) {
  for (const alias of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) {
    const model = parseJson(alias.value, null);
    if (isString(model) && model.startsWith(`${prefix}/`)) {
      if (replacement) db.run(`UPDATE kv SET value = ? WHERE scope = 'modelAliases' AND key = ?`, [stringifyJson(`${replacement}${model.slice(prefix.length)}`), alias.key]);
      else db.run(`DELETE FROM kv WHERE scope = 'modelAliases' AND key = ?`, [alias.key]);
    }
  }
}

export async function updateProviderNode(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToNode(row);
    data = { ...data, ...assertValidProviderNode(data, { type: current.type }) };
    if (data.prefix !== undefined && data.prefix !== current.prefix && ownsPrefix(db, current, current.prefix)) {
      rewriteOwnedAliases(db, current.prefix, id);
    }
    const merged = { ...current, ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

async function removeProviderNode(id, includeConnections) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToNode(row);
    if (includeConnections) deleteProviderConnectionsByProviderInTx(db, id);
    const prefixOwned = ownsPrefix(db, removed, removed.prefix);
    db.run(`DELETE FROM providerNodes WHERE id = ?`, [id]);
    rewriteOwnedAliases(db, id, null);
    if (prefixOwned && removed.prefix !== id) rewriteOwnedAliases(db, removed.prefix, null);
    // Keep custom models for prefixes shared with another node or a built-in.
    const prefix = removed.prefix;
    for (const alias of [id, prefixOwned ? prefix : null].filter(Boolean)) {
      const head = `${alias}|`;
      db.run(`DELETE FROM kv WHERE scope = 'customModels' AND substr(key, 1, ?) = ?`, [head.length, head]);
    }
  });
  return removed;
}

export async function deleteProviderNode(id) {
  return removeProviderNode(id, false);
}

// All provider-owned data and the scoped-key guard share one transaction.
export async function deleteProviderNodeWithConnections(id) {
  return removeProviderNode(id, true);
}
