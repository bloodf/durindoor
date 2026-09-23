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
import m010 from "./010-token-saver-events.js";
import m011 from "./011-model-capability-overrides.js";
import m012 from "./012-mcp-provider-connection.js";
import m013 from "./013-combo-invariant.js";
import m014 from "./014-api-key-provider-connections.js";
import m015 from "./015-combo-members.js";
import m016 from "./016-combo-capabilities.js";
import m017 from "./017-connection-groups.js";
import m018 from "./018-api-key-groups.js";
import m020 from "./020-token-saver-aggregates.js";
import m021 from "./021-usage-last-seen.js";
import m022 from "./022-token-saver-daily.js";
import m023 from "./023-usage-latency.js";
import m024 from "./024-usage-history-api-key-index.js";

export const MIGRATIONS = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011, m012, m013, m014, m015, m016, m017, m018, m020, m021, m022, m023, m024].sort(
  (a, b) => a.version - b.version
);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
