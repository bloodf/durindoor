// Migration 009 — encrypt plaintext credential fields on providerConnections.
//
// SEC-B-02: at-rest encryption for accessToken / refreshToken / apiKey /
// idToken on providerConnections.data. The four fields are replaced with
// AES-256-GCM blobs { v, iv, ct } keyed by <DATA_DIR>/master-key and bound to
// the row id via Additional Authenticated Data.
//
// Idempotent: rows whose fields are already blobs are skipped; rows whose
// fields are missing or non-string are also skipped. Re-running after a
// partially-applied migration is safe.
//
// The migration uses the synchronous AES-256-GCM API from columnCrypto so it
// can run inside migrate.js's synchronous per-version transaction.
//
// Guards: skips cleanly when providerConnections is absent OR when its `data`
// column is absent (e.g. partial-schema fixtures in db-migration-chain and
// db-quota-v8-migration tests seed providerConnections without `data`).

import {
  encryptField,
  isEncryptedBlob,
} from "../../crypto/columnCrypto.js";
import { SENSITIVE_CONNECTION_FIELDS } from "../repos/connectionsRepo.js";

const migration = {
  version: 9,
  name: "encrypt-credentials",
  up(db) {
    const tableRow = db.get(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'providerConnections'`,
    );
    if (!tableRow) return;
    const colRow = db.get(
      `SELECT name FROM pragma_table_info('providerConnections') WHERE name = 'data'`,
    );
    if (!colRow) return;
    const rows = db.all(`SELECT id, data FROM providerConnections`);
    for (const row of rows) {
      if (typeof row.data !== "string" || row.data.length === 0) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(row.data);
      } catch {
        // Leave malformed JSON alone; other migrations / runtime paths
        // surface the real corruption.
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;
      let dirty = false;
      for (const field of SENSITIVE_CONNECTION_FIELDS) {
        const value = parsed[field];
        if (typeof value !== "string" || value.length === 0) continue;
        if (isEncryptedBlob(value)) continue;
        parsed[field] = encryptField(value, row.id);
        dirty = true;
      }
      if (dirty) {
        db.run(
          `UPDATE providerConnections SET data = ? WHERE id = ?`,
          [JSON.stringify(parsed), row.id],
        );
      }
    }
  },
};

export default migration;
