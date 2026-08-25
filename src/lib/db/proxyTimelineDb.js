import { openSqliteAdapter } from "./driver.js";
import { ensureDirs, currentProxyTimelineFile, hardenPermissions } from "./paths.js";
import { PRAGMA_SQL } from "./schema.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT, status TEXT,
  provider TEXT, model TEXT, connection_id TEXT, api_key_id TEXT, endpoint TEXT,
  client_format TEXT, provider_format TEXT, fallback_count INTEGER NOT NULL DEFAULT 0,
  ttft_ms INTEGER, total_ms INTEGER, event_count INTEGER NOT NULL DEFAULT 0,
  payload_bytes INTEGER NOT NULL DEFAULT 0, redacted INTEGER NOT NULL DEFAULT 1,
  truncated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, trace_id TEXT NOT NULL, seq INTEGER NOT NULL,
  t_ms INTEGER NOT NULL, type TEXT NOT NULL, direction TEXT NOT NULL, summary TEXT,
  payload TEXT, UNIQUE(trace_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_pt_started ON traces(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pt_provider ON traces(provider);
CREATE INDEX IF NOT EXISTS idx_pt_model ON traces(model);
CREATE INDEX IF NOT EXISTS idx_pt_conn ON traces(connection_id);
CREATE INDEX IF NOT EXISTS idx_pt_key ON traces(api_key_id);
CREATE INDEX IF NOT EXISTS idx_pt_status ON traces(status);
CREATE INDEX IF NOT EXISTS idx_pt_events ON events(trace_id, seq);
`;

if (!global._proxyTimelineAdapter) global._proxyTimelineAdapter = { instance: null, initPromise: null, file: null };
const state = global._proxyTimelineAdapter;

export async function getProxyTimelineAdapter() {
  const file = currentProxyTimelineFile();
  if (state.instance && state.file !== file) {
    try { await state.instance.close?.(); } catch {}
    state.instance = null;
    state.initPromise = null;
  }
  if (state.instance) return state.instance;
  if (!state.initPromise) {
    state.initPromise = (async () => {
      ensureDirs();
      const adapter = await openSqliteAdapter(file);
      adapter.exec(PRAGMA_SQL);
      adapter.exec(SCHEMA_SQL);
      hardenPermissions();
      state.file = file;
      state.instance = adapter;
      return adapter;
    })().catch((error) => {
      state.initPromise = null;
      throw error;
    });
  }
  return state.initPromise;
}
