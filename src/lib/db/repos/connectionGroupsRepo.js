import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { getProviderConnectionById } from "./connectionsRepo.js";
import { isString } from "../../../shared/utils/typeChecks.js";

// Connection groups (issue #747 / port of decolua/9router #3748, minus the
// unsafe key-export unit). Groups are a UI-organizational wrapper over
// provider-connection rows. They never participate in dispatch on their own;
// the dashboard expands a group into its member ids and stores them in
// `combos.allowedConnectionIds`. This repo keeps the storage layer narrow
// and trust-the-API on membership semantics.

const NAME_REGEX = /^[a-zA-Z0-9_.\- ]{1,64}$/;
const MAX_DESCRIPTION = 240;
const MAX_BULK_MEMBERS = 500;

export class ConnectionGroupNotFoundError extends Error {
  constructor(id) {super(`Connection group not found: ${id}`);this.name = "ConnectionGroupNotFoundError";}
}

export class ConnectionGroupValidationError extends Error {
  constructor(message, code = "invalid") {super(message);this.name = "ConnectionGroupValidationError";this.code = code;}
}

function rowToGroup(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function validateGroupName(name) {
  if (!isString(name) || !NAME_REGEX.test(name)) {
    throw new ConnectionGroupValidationError(
      "name must be 1-64 chars of letters, digits, space, dot, dash, underscore",
      "invalid_name"
    );
  }
  return name;
}

export function validateGroupDescription(description) {
  if (description == null) return null;
  if (!isString(description)) {
    throw new ConnectionGroupValidationError("description must be a string", "invalid_description");
  }
  if (description.length > MAX_DESCRIPTION) {
    throw new ConnectionGroupValidationError(
      `description exceeds ${MAX_DESCRIPTION} chars`,
      "invalid_description"
    );
  }
  return description;
}

/**
 * Validate a candidate set of connection ids BEFORE persistence. Rejects
 * non-strings, empty strings, duplicates, missing rows, and bulk oversize so
 * a UI typo cannot orphan a group's membership or store a stale id.
 */
export async function validateConnectionIds(ids) {
  if (!Array.isArray(ids)) {
    throw new ConnectionGroupValidationError("ids must be an array", "invalid_ids");
  }
  if (ids.length > MAX_BULK_MEMBERS) {
    throw new ConnectionGroupValidationError(
      `too many ids (max ${MAX_BULK_MEMBERS})`,
      "too_many_ids"
    );
  }
  const seen = new Set();
  const out = [];
  for (const raw of ids) {
    if (!isString(raw) || raw.length === 0 || raw.length > 128) {
      throw new ConnectionGroupValidationError(
        "id must be a non-empty string up to 128 chars",
        "invalid_id"
      );
    }
    if (seen.has(raw)) {
      throw new ConnectionGroupValidationError(
        `duplicate id: ${raw}`,
        "duplicate_id"
      );
    }
    seen.add(raw);
    out.push(raw);
  }
  for (const id of out) {
    const conn = await getProviderConnectionById(id);
    if (!conn) {
      throw new ConnectionGroupValidationError(
        `unknown connection id: ${id}`,
        "unknown_id"
      );
    }
  }
  return out;
}

export async function getConnectionGroups() {
  const db = await getAdapter();
  const groups = db.all(`SELECT * FROM connectionGroups ORDER BY name COLLATE NOCASE ASC`);
  return groups.map((g) => {
    const members = db.all(`SELECT connectionId FROM connectionGroupMembers WHERE groupId = ?`, [g.id]).map((r) => r.connectionId);
    return { ...rowToGroup(g), connectionIds: members };
  });
}

export async function getConnectionGroupById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM connectionGroups WHERE id = ?`, [id]);
  if (!row) return null;
  const members = db.all(`SELECT connectionId FROM connectionGroupMembers WHERE groupId = ?`, [id]).map((r) => r.connectionId);
  return { ...rowToGroup(row), connectionIds: members };
}

export async function getConnectionGroupByName(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM connectionGroups WHERE name = ?`, [name]);
  if (!row) return null;
  const members = db.all(`SELECT connectionId FROM connectionGroupMembers WHERE groupId = ?`, [row.id]).map((r) => r.connectionId);
  return { ...rowToGroup(row), connectionIds: members };
}

export async function createConnectionGroup({ name, description = null, connectionIds = [] }) {
  const validatedName = validateGroupName(name);
  const validatedDescription = validateGroupDescription(description);
  const validatedIds = await validateConnectionIds(connectionIds);
  const db = await getAdapter();
  const now = new Date().toISOString();
  const group = {
    id: uuidv4(),
    name: validatedName,
    description: validatedDescription,
    createdAt: now,
    updatedAt: now
  };
  db.transaction(() => {
    const existing = db.get(`SELECT id FROM connectionGroups WHERE name = ? COLLATE NOCASE`, [validatedName]);
    if (existing) throw new ConnectionGroupValidationError(`group name already exists: ${validatedName}`, "duplicate_name");
    db.run(
      `INSERT INTO connectionGroups(id, name, description, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)`,
      [group.id, group.name, group.description, group.createdAt, group.updatedAt]
    );
    for (const cid of validatedIds) {
      db.run(
        `INSERT OR IGNORE INTO connectionGroupMembers(groupId, connectionId, createdAt) VALUES(?, ?, ?)`,
        [group.id, cid, now]
      );
    }
  });
  return { ...group, connectionIds: validatedIds };
}

export async function updateConnectionGroup(id, { name, description, connectionIds }) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM connectionGroups WHERE id = ?`, [id]);
  if (!row) throw new ConnectionGroupNotFoundError(id);
  const now = new Date().toISOString();
  const next = {
    name: name !== undefined ? validateGroupName(name) : row.name,
    description: description !== undefined ? validateGroupDescription(description) : row.description,
    connectionIds: undefined
  };
  if (connectionIds !== undefined) {
    next.connectionIds = await validateConnectionIds(connectionIds);
  }
  db.transaction(() => {
    if (name !== undefined) {
      const dupe = db.get(
        `SELECT id FROM connectionGroups WHERE name = ? COLLATE NOCASE AND id != ?`,
        [next.name, id]
      );
      if (dupe) throw new ConnectionGroupValidationError(`group name already exists: ${next.name}`, "duplicate_name");
    }
    db.run(
      `UPDATE connectionGroups SET name = ?, description = ?, updatedAt = ? WHERE id = ?`,
      [next.name, next.description, now, id]
    );
    if (Array.isArray(next.connectionIds)) {
      db.run(`DELETE FROM connectionGroupMembers WHERE groupId = ?`, [id]);
      for (const cid of next.connectionIds) {
        db.run(
          `INSERT OR IGNORE INTO connectionGroupMembers(groupId, connectionId, createdAt) VALUES(?, ?, ?)`,
          [id, cid, now]
        );
      }
    }
  });
  return getConnectionGroupById(id);
}

export async function deleteConnectionGroup(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM connectionGroups WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function addConnectionToGroup(groupId, connectionId) {
  const db = await getAdapter();
  const group = db.get(`SELECT id FROM connectionGroups WHERE id = ?`, [groupId]);
  if (!group) throw new ConnectionGroupNotFoundError(groupId);
  await validateConnectionIds([connectionId]);
  const existing = db.get(
    `SELECT 1 FROM connectionGroupMembers WHERE groupId = ? AND connectionId = ?`,
    [groupId, connectionId]
  );
  if (existing) {
    throw new ConnectionGroupValidationError(
      `connection is already in group: ${connectionId}`,
      "duplicate_membership"
    );
  }
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO connectionGroupMembers(groupId, connectionId, createdAt) VALUES(?, ?, ?)`,
    [groupId, connectionId, now]
  );
  db.run(`UPDATE connectionGroups SET updatedAt = ? WHERE id = ?`, [now, groupId]);
  return true;
}

export async function removeConnectionFromGroup(groupId, connectionId) {
  const db = await getAdapter();
  const group = db.get(`SELECT id FROM connectionGroups WHERE id = ?`, [groupId]);
  if (!group) throw new ConnectionGroupNotFoundError(groupId);
  await validateConnectionIds([connectionId]);
  const now = new Date().toISOString();
  db.transaction(() => {
    const res = db.run(
      `DELETE FROM connectionGroupMembers WHERE groupId = ? AND connectionId = ?`,
      [groupId, connectionId]
    );
    if ((res?.changes ?? 0) === 0) {
      throw new ConnectionGroupValidationError(
        `connection is not in group: ${connectionId}`,
        "unknown_membership"
      );
    }
    db.run(`UPDATE connectionGroups SET updatedAt = ? WHERE id = ?`, [now, groupId]);
  });
  return true;
}
