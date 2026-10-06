export default {
  version: 25,
  name: "proxy-timeline",
  up(adapter) {
    adapter.exec(`
      CREATE TABLE IF NOT EXISTS "proxyTimelineTraces" (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT, status TEXT, provider TEXT, model TEXT, connection_id TEXT, api_key_id TEXT, endpoint TEXT, client_format TEXT, provider_format TEXT, fallback_count INTEGER NOT NULL DEFAULT 0, ttft_ms INTEGER, total_ms INTEGER, event_count INTEGER NOT NULL DEFAULT 0, payload_bytes INTEGER NOT NULL DEFAULT 0, redacted INTEGER NOT NULL DEFAULT 1, truncated INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS "proxyTimelineEvents" (id BIGSERIAL PRIMARY KEY, trace_id TEXT NOT NULL REFERENCES "proxyTimelineTraces"(id) ON DELETE CASCADE, seq INTEGER NOT NULL, t_ms INTEGER NOT NULL, type TEXT NOT NULL, direction TEXT NOT NULL, summary TEXT, payload TEXT, UNIQUE(trace_id, seq));
      CREATE INDEX IF NOT EXISTS "idx_pt_started" ON "proxyTimelineTraces"(started_at DESC); CREATE INDEX IF NOT EXISTS "idx_pt_provider" ON "proxyTimelineTraces"(provider); CREATE INDEX IF NOT EXISTS "idx_pt_model" ON "proxyTimelineTraces"(model); CREATE INDEX IF NOT EXISTS "idx_pt_conn" ON "proxyTimelineTraces"(connection_id); CREATE INDEX IF NOT EXISTS "idx_pt_key" ON "proxyTimelineTraces"(api_key_id); CREATE INDEX IF NOT EXISTS "idx_pt_status" ON "proxyTimelineTraces"(status); CREATE INDEX IF NOT EXISTS "idx_pt_events" ON "proxyTimelineEvents"(trace_id, seq);
    `);
  },
};
