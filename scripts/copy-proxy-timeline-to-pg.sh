#!/usr/bin/env bash
set -euo pipefail

source_db=${1:?usage: DURINDOOR_PG_URL=... scripts/copy-proxy-timeline-to-pg.sh /path/proxy-timeline.sqlite}
: "${DURINDOOR_PG_URL:?DURINDOOR_PG_URL is required}"
container=${DURINDOOR_PG_CONTAINER:-cortex-postgresql}
copy_url=${DURINDOOR_PG_COPY_URL:-$DURINDOOR_PG_URL}
workdir=$(mktemp -d "${TMPDIR:-/tmp}/durindoor-timeline-copy.XXXXXX")
remote_dir=/tmp/durindoor-timeline-copy-$$
trap 'rm -rf "$workdir"; docker exec "$container" rm -rf "$remote_dir" >/dev/null 2>&1 || true' EXIT

traces_columns='id,started_at,ended_at,status,provider,model,connection_id,api_key_id,endpoint,client_format,provider_format,fallback_count,ttft_ms,total_ms,event_count,payload_bytes,redacted,truncated'
events_columns='id,trace_id,seq,t_ms,type,direction,summary,payload'

summary_sqlite() {
  local table=$1 columns=$2 expressions=''
  IFS=, read -ra names <<<"$columns"
  for name in "${names[@]}"; do
    expressions+=" || '|' || COALESCE(SUM(LENGTH(COALESCE(CAST($name AS TEXT), ''))),0)"
  done
  sqlite3 -readonly "$source_db" "SELECT COUNT(*) || '|' || COALESCE(MIN(CAST(id AS TEXT)), '') || '|' || COALESCE(MAX(CAST(id AS TEXT)), '')$expressions FROM $table"
}

export_csv() {
  local table=$1 columns=$2 output=$3
  sqlite3 -readonly "$source_db" <<SQL >"$output"
.mode csv
.nullvalue \\N
SELECT $columns FROM $table ORDER BY id;
SQL
}

traces_summary=$(summary_sqlite traces "$traces_columns")
events_summary=$(summary_sqlite events "$events_columns")
export_csv traces "$traces_columns" "$workdir/traces.csv"
export_csv events "$events_columns" "$workdir/events.csv"
docker exec "$container" mkdir -p "$remote_dir"
docker cp "$workdir/traces.csv" "$container:$remote_dir/traces.csv"
docker cp "$workdir/events.csv" "$container:$remote_dir/events.csv"
docker exec "$container" chown -R postgres:postgres "$remote_dir"
docker exec "$container" chmod 700 "$remote_dir"
docker exec "$container" chmod 600 "$remote_dir/traces.csv" "$remote_dir/events.csv"

# Single psql session: target remains empty unless copy, verification, and
# sequence repair all succeed.
docker exec -u postgres -i "$container" psql "$copy_url" -v ON_ERROR_STOP=1 \
  -v traces_csv="$remote_dir/traces.csv" -v events_csv="$remote_dir/events.csv" \
  -v traces_summary="$traces_summary" -v events_summary="$events_summary" <<'SQL'
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "proxyTimelineTraces") OR EXISTS (SELECT 1 FROM "proxyTimelineEvents") THEN
    RAISE EXCEPTION 'proxy timeline target tables are not empty';
  END IF;
END $$;
CREATE TEMP TABLE expected_timeline_summary (traces text NOT NULL, events text NOT NULL) ON COMMIT DROP;
INSERT INTO expected_timeline_summary VALUES (:'traces_summary', :'events_summary');
SELECT format('COPY "proxyTimelineTraces" (id,started_at,ended_at,status,provider,model,connection_id,api_key_id,endpoint,client_format,provider_format,fallback_count,ttft_ms,total_ms,event_count,payload_bytes,redacted,truncated) FROM %L WITH (FORMAT csv, NULL ''\N'')', :'traces_csv') \gexec
SELECT format('COPY "proxyTimelineEvents" (id,trace_id,seq,t_ms,type,direction,summary,payload) FROM %L WITH (FORMAT csv, NULL ''\N'')', :'events_csv') \gexec
DO $$
DECLARE actual text;
BEGIN
  SELECT COUNT(*) || '|' || COALESCE(MIN(id), '') || '|' || COALESCE(MAX(id), '') || '|' || COALESCE(SUM(LENGTH(COALESCE(id, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(started_at, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(ended_at, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(status, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(provider, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(model, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(connection_id, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(api_key_id, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(endpoint, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(client_format, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(provider_format, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(fallback_count::text, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(ttft_ms::text, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(total_ms::text, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(event_count::text, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(payload_bytes::text, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(redacted::text, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(truncated::text, ''))),0) INTO actual FROM "proxyTimelineTraces";
  IF actual <> (SELECT traces FROM expected_timeline_summary) THEN RAISE EXCEPTION 'traces semantic aggregate mismatch'; END IF;
  SELECT COUNT(*) || '|' || COALESCE(MIN(id::text), '') || '|' || COALESCE(MAX(id::text), '') || '|' || COALESCE(SUM(LENGTH(COALESCE(id::text, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(trace_id, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(seq::text, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(t_ms::text, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(type, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(direction, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(summary, ''))),0) || '|' || COALESCE(SUM(LENGTH(COALESCE(payload, ''))),0) INTO actual FROM "proxyTimelineEvents";
  IF actual <> (SELECT events FROM expected_timeline_summary) THEN RAISE EXCEPTION 'events semantic aggregate mismatch'; END IF;
END $$;
SELECT setval(pg_get_serial_sequence('"proxyTimelineEvents"', 'id'), COALESCE((SELECT MAX(id) FROM "proxyTimelineEvents"), 1), EXISTS (SELECT 1 FROM "proxyTimelineEvents"));
COMMIT;
SQL
printf 'traces verified: %s\nevents verified: %s\n' "$traces_summary" "$events_summary"
