// Migration registry — append new entries when schema changes.
// Each migration: { version: number, name: string, up(db): void }
// Versions MUST be unique and monotonically increasing.
import m001 from "./001-initial.js";
import m002 from "./002-mcp-gateway.js";
import m003 from "./003-mcp-grant-tools.js";
import m004 from "./004-daily-token-limit.js";
import m005 from "./005-api-key-expiry.js";
import m006 from "./006-api-key-policy.js";
import m007 from "./007-provider-quota-snapshots.js";
import m008 from "./008-quota-reservations.js";
import m009 from "./009-encrypt-credentials.js";

export const MIGRATIONS = [m001, m002, m003, m004, m005, m006, m007, m008, m009].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
