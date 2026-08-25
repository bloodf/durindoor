# Proxy Timeline Design

## Problem

DurinDoor's Usage → Details tab is a completion snapshot: one JSON blob per
finished call, 200-row cap, 5 KiB body truncation, no API-key filter, no
per-hop events, no live tail. Operators cannot answer "what did this proxy
call send, receive, and do at each hop?" while the call is in flight or for
the last 1–7 days.

A live bug makes the existing observability toggle unreliable: the profile
page writes `enableObservability` (`src/app/(dashboard)/dashboard/profile/page.js`)
while `requestDetailsRepo.getObservabilityConfig()` reads
`enableObservability2`. The two keys never meet.

## Goals

- Live tail plus searchable history of every proxy call.
- Full hop timeline including every redacted SSE frame.
- Settings: feature on/off (default off) and retention of 1, 3, or 7 days.
- Provider page **View all** filter into the same page.
- Secrets never stored or shown. No unredacted mode.

## Non-goals

- Replacing or deleting Usage → Details. That snapshot stays.
- OpenTelemetry export or a collector.
- Putting timeline rows in `data.sqlite` or in schema-migration backups.
- Compacted / sampled chunk storage. v1 stores every redacted frame.
- A disk-quota setting. Retention days are the only v1 bound.
- Visual mockups as a delivery. The page follows existing dashboard cards,
  tables, and drawers.

## Approach

Sidecar store + new page (approach B). Isolated SQLite file, isolated
dashboard route, fail-open emit path next to `saveRequestDetail` rather
than inside it.

## Settings

Canonical keys in `src/lib/db/repos/settingsRepo.js` defaults and
`PATCH /api/settings`:

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enableObservability` | boolean | `true` | Existing Usage → Details capture. |
| `enableProxyTimeline` | boolean | `false` | New sidecar capture. |
| `proxyTimelineRetentionDays` | `1 \| 3 \| 7` | `1` | Delete traces older than this. |

Migration, once, on settings load: if the stored row has own-property
`enableObservability2` and does **not** have own-property
`enableObservability`, copy the boolean into `enableObservability`. Then
always drop `enableObservability2`. If both keys exist, keep
`enableObservability` (the profile page's written value) and drop
`enableObservability2`. After that, only `enableObservability` is read
or written.

Profile observability block (`/dashboard/profile`):

- Existing Request details toggle stays, bound to `enableObservability`.
- New **Proxy timeline** toggle bound to `enableProxyTimeline`.
- Retention select (1 / 3 / 7 days) enabled only when timeline is on.
- Note: sidecar path `${DATA_DIR}/db/proxy-timeline.sqlite`, not in
  backups, secrets always redacted.

Capture off: `record()` is a no-op. Existing rows stay until they age out
or the operator clears them. Turning capture on does not require a restart.

## Sidecar store

Path: `${currentDbDir()}/proxy-timeline.sqlite` via `src/lib/db/paths.js`
(`currentDbDir()` already exists). Own better-sqlite3 / adapter handle.
Never opened by the main schema migrator. Never copied into
`db/backups/`. A write or open failure must not throw into chatCore.

### `traces`

One row per proxy call.

- `id` TEXT PRIMARY KEY
- `started_at` TEXT NOT NULL (ISO)
- `ended_at` TEXT
- `status` TEXT (`open` \| `success` \| `error` \| `aborted`)
- `provider` TEXT
- `model` TEXT
- `connection_id` TEXT
- `api_key_id` TEXT (id or name only; never the secret)
- `endpoint` TEXT
- `client_format` TEXT
- `provider_format` TEXT
- `fallback_count` INTEGER NOT NULL DEFAULT 0
- `ttft_ms` INTEGER
- `total_ms` INTEGER
- `event_count` INTEGER NOT NULL DEFAULT 0
- `payload_bytes` INTEGER NOT NULL DEFAULT 0
- `redacted` INTEGER NOT NULL DEFAULT 1
- `truncated` INTEGER NOT NULL DEFAULT 0

Indexes: `started_at DESC`, `provider`, `model`, `connection_id`,
`api_key_id`, `status`.

### `events`

One row per hop and per redacted SSE frame.

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `trace_id` TEXT NOT NULL
- `seq` INTEGER NOT NULL
- `t_ms` INTEGER NOT NULL (ms since `started_at`)
- `type` TEXT NOT NULL (`ingress` \| `auth` \| `route` \| `fallback` \|
  `translate` \| `upstream_connect` \| `upstream_headers` \| `sse_chunk` \|
  `terminal` \| `client_write` \| `error`)
- `direction` TEXT NOT NULL (`in` \| `out` \| `internal`)
- `summary` TEXT
- `payload` TEXT (JSON, already redacted; may be NULL)

Unique `(trace_id, seq)`. Index `trace_id, seq`.

Retention job: dedicated timer (not the requestDetails flush loop)
deletes `traces` where `started_at` is older than
`proxyTimelineRetentionDays`, then deletes orphan `events`. Run at
least once per process hour.

## Capture path

New module `open-sse/handlers/chatCore/proxyTimeline.js`:

- `startTrace(fields)` → `traceId`
- `record(traceId, event)` — enqueue only; no-op when
  `enableProxyTimeline` is false
- `finishTrace(traceId, fields)`

Fail-open: every public function swallows storage errors. `record` and
the frame tap only push onto an in-memory queue and return; they do
not open SQLite.

**Writer.** Same shape as `requestDetailsRepo` (`writeBuffer` +
`flushToDatabase`). better-sqlite3 is synchronous, so flush **does**
run on the JS thread. Bound that:

- Queue: cap 10_000 events or 32 MiB encoded, whichever first.
- Flush: at most 50 queued rows per turn, on a 250 ms timer or when
  50 events are waiting. One `db.transaction` per flush. Schedule the
  next 50-row flush with `setImmediate` if the queue still has rows.
  Never flush the whole 10k cap in one turn.
- Overflow: never grow past cap. If the next event is `sse_chunk` and
  the queue is full, drop it and bump the in-memory `_dropped` count
  for that `traceId`. If the next event is a hop (`error`, `terminal`,
  `fallback`, `auth`, `route`, `ingress`, `translate`,
  `upstream_connect`, `upstream_headers`, `client_write`) and the
  queue is full, evict the oldest queued `sse_chunk` for any trace,
  bump that trace’s `_dropped`, then enqueue the hop. If no
  `sse_chunk` remains to evict, increment `_dropped` for the hop’s
  trace and drop the hop. Persist `_dropped` as one marker event
  `{ type: "sse_chunk", summary: "dropped N frames", payload:
  { _dropped: N } }` per affected trace on the next successful flush
  that has room, and set `traces.truncated`.
- The client-byte path must still forward bytes to the client when the
  queue is full or a flush is running.

**Call sites.**

- `open-sse/handlers/chatCore.js` — `startTrace` at ingress; `record`
  for auth, route, error, abort; `finishTrace` on non-stream terminal
- `open-sse/handlers/chatCore/nonStreamingHandler.js` — terminal
- `open-sse/handlers/chatCore/sseToJsonHandler.js` — terminal
- `open-sse/services/accountFallback.js` — one `fallback` event per hop

**Client frames.** `streamingHandler` / `onStreamComplete` only see
the start placeholder and the completion aggregate. `reader.read()`
in `createDisconnectAwareStream` yields **arbitrary byte chunks**,
not SSE frames. Synthesized abort / recovery bytes from
`onAbortTerminal` / `terminalTracker.buildRecoveryBytes()` are
enqueued **after** the transform and would be missed by a
post-transform tap.

Add `onClientBytes(chunk)`, `onClientEnd()`, and `onClientAbort()` on
`createDisconnectAwareStream` and thread them through
`pipeWithDisconnect`. Call `onClientBytes` for every
`controller.enqueue(value)` path: upstream `value`, `emitTerminal`
bytes, and `emitClientRecovery` bytes. The original chunk is enqueued
immediately either way. Call `onClientEnd` after the last enqueue on
clean EOF (`done`). Call `onClientAbort` after the last enqueue on
error, stall, disconnect, or cancel. Both finalizers must run even
when no extra bytes were synthesized.

Framer (new helper `open-sse/handlers/chatCore/proxyTimelineFrame.js`):
consume those arbitrary chunks. Do **not** wait only for `\\n\\n`.
`stream.js` passthrough emits each `data:` as `output + "\\n"` and
drops blank lines, so a blank-delimiter-only framer would hold the
whole stream until EOF. Rules:

- SSE: accumulate an optional `event:` line; finalize the record on
  the following `data:` line (repo passthrough). Also accept
  canonical blank-delimited events (`\\n\\n` / `\\r\\n\\r\\n`),
  including `formatSSE` output.
- NDJSON (Ollama): finalize on each newline.
- Keep the partial tail. `onClientEnd` and `onClientAbort` both
  `flush()` a non-empty tail as one record.

Each complete record is redacted then
`record({ type: "sse_chunk", direction: "out", payload })`.
`handleStreamingResponse` wires the three callbacks to the framer; it
does not assume one enqueue = one event.

`saveRequestDetail` is unchanged. Timeline does not read or write
`requestDetails`.

## Redaction

Recursive redact before any write. Reuse and extend the header sanitizer
in `src/lib/db/repos/requestDetailsRepo.js` (`sanitizeHeaders`) into a
shared **key-match list**. Timeline replaces matching values with
`[redacted]` and keeps the keys. `requestDetails` keeps deleting those
keys (current snapshot behaviour). Do not change Details output.

- Header / field names containing `authorization`, `x-api-key`, `cookie`,
  `token`, `api-key`, `set-cookie`, `x-goog-api-key`: timeline replaces
  the **value** with `[redacted]`.
- JSON / text bodies: same key names plus bearer / `sk-` / `sk_` /
  `AIza` shaped secrets become `[redacted]`.
- Query strings: credential parameters stripped.
- API key secret never stored; only `api_key_id` / display name.

Every stored payload is treated as already redacted. Copy-as-JSON on the
detail page dumps the stored rows as-is. There is no "show raw" control.

If a payload is too large for a single SQLite TEXT comfortably
(implementation ceiling: 1 MiB encoded), store a marker
`{ _truncated: true, _originalSize, _preview }` and set `traces.truncated`.
This is a safety valve, not a substitute for retention.

## HTTP API

Dashboard-auth only. Same session / CSRF rules as `/api/usage/request-details`.
- `GET /api/timeline` — paged traces. Query: `page`, `pageSize`,
  `provider`, `model`, `connectionId`, `apiKeyId`, `status`, `endpoint`,
  `startDate`, `endDate`, `q` (matches `id`). Query names are these
  camelCase forms only (`connectionId`, not `connection`).
- `GET /api/timeline/:id` — one trace plus ordered events.
- `GET /api/timeline/stream` — SSE of `{ type: "trace"|"event", ... }`
  for new writes. Same filter query as the list. Dashboard auth required.
- `DELETE /api/timeline` — clear all traces (settings / danger action).

List rows omit `events`. Detail always includes them.

## UI

### Nav

`src/shared/components/SidebarNavIcons.js` `navItems`, after Usage:

```js
{ href: "/dashboard/timeline", label: "Timeline", icon: "timeline" }
```

Usage remains `/dashboard` home. Header (`src/shared/components/Header.js`)
gains Timeline and Timeline / `{id}` breadcrumbs, same pattern as
Providers / `{name}`.

### List — `/dashboard/timeline`

Query string is the filter source of truth.

- Live toggle. On: open `GET /api/timeline/stream` and prepend / patch
  rows. Off: history only.
- Filters: API-key id/name, model, provider, connection, status,
  endpoint, start/end. Changing a filter rewrites the URL.
- Table: started, status, provider/model, key name, connection, ttft,
  total, event count.
- Empty: capture off → link to Settings. Capture on, no rows →
  "waiting for a call".

### Detail — `/dashboard/timeline/[id]`

Vertical hop list, oldest first. SSE frames start collapsed as
"N chunks"; expand to every redacted frame. Each hop shows `t_ms`,
`type`, `direction`, `summary`, payload. Copy-as-JSON of the stored
(redacted) trace.

### Provider View all

On `/dashboard/providers/[id]` header, next to Back:
`/dashboard/timeline?provider={id}`

On a connection row:
`/dashboard/timeline?provider={id}&connectionId={connectionId}`

v1 does not add View all on the providers grid card.

## Testing

- Settings: `enableObservability2` migrates once as specified; timeline
  keys persist; capture off makes `record` a no-op. Writer overflow
  sets `truncated` and records `_dropped` without growing past cap.
  A flush writes at most 50 rows per turn.
- Redaction: authorization header, `sk-` body token, and query credential
  never appear in `traces` or `events`.
- Retention: a trace older than the selected days is deleted with its
  events; newer traces stay.
- Capture fail-open: a closed / unwritable sidecar does not throw from
  chatCore.
- API: list filters, detail includes events in `seq` order, stream is
  dashboard-authed. Client frames come from `onClientBytes` on
  `createDisconnectAwareStream` after incremental framing. Trailing
  tails flush via `onClientEnd` / `onClientAbort`. Framer finalizes
  repo passthrough `data: ...\\n` chunks and canonical `\\n\\n`
  events; it does not wait for a blank line that passthrough never
  sends.
- UI contract tests only where the repo already tests nav / settings
  (nav item present; View all href shape). No screenshot suite.

## Docs

- This spec.
- `docs/guides/usage.md` dashboard-areas table: add Timeline.
- `docs/features/proxy-timeline.md`: operator-facing page (settings,
  retention, redaction, sidecar path).
- `CHANGELOG.md` Unreleased when the feature ships, not with this spec.

## Risks

- Raw SSE frames at 7 days will grow the sidecar. Isolation plus default
  off plus retention are the v1 controls. Disk quota is out of scope.
- Emit sites can miss a hop if a new executor path is added later. The
  module is the contract; new chat paths must call `record`.
- Header sanitizer today deletes keys; timeline needs recursive body
  redaction too. Share one helper, do not fork two lists.

## Scope

No change to `requestDetails` schema, Usage → Details UI, or the 200-row
/ 5 KiB snapshot behaviour beyond the `enableObservability` key fix.
No new npm dependency. No wire-format change.
