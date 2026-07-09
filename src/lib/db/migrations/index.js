// Migration registry — append new entries when schema changes.
// Each migration: { version: number, name: string, up(db): void }
// Versions MUST be unique and monotonically increasing.
import m001 from "./001-initial.js";
import m002 from "./002-mcp-gateway.js";
import m003 from "./003-mcp-grant-tools.js";
import m004 from "./004-daily-token-limit.js";
// NOTE: 005-api-key-policy.js exists in this directory but is intentionally not
// registered in this fork. It predates this port and adds schema/columns that are
// not yet reflected in the current schema. Version 6 is used for the next migration.
import m006 from "./006-api-key-expiry.js";

export const MIGRATIONS = [m001, m002, m003, m004, m006].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
