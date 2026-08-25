# Proxy Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a sidecar proxy-call timeline: live tail plus 1/3/7-day redacted hop and SSE-frame history, with settings toggles and provider View all.

**Architecture:** Isolated SQLite file `${currentDbDir()}/proxy-timeline.sqlite`. Fail-open emit API next to `saveRequestDetail`. Client frames are incrementally framed from `createDisconnectAwareStream` `onClientBytes`, not from `onStreamComplete`. Usage → Details snapshot stays.

**Tech Stack:** JavaScript, Vitest, existing sqlite adapters (`createBetterSqliteAdapter` and fallbacks), Next.js app-router API + dashboard.

**Spec:** `docs/superpowers/specs/2026-08-22-proxy-timeline-design.md`

## Global Constraints

- No new npm dependency.
- Do not modify `tests/__baseline__/known-fails.txt`.
- Do not change `requestDetails` schema or Usage → Details UI beyond the `enableObservability` key fix.
- Flat settings keys only: `enableObservability`, `enableProxyTimeline`, `proxyTimelineRetentionDays`.
- Canonical observability key is `enableObservability` (default `true`). Migrate stored `enableObservability2` into it only when `enableObservability` is absent, then always drop `enableObservability2`.
- Do not add `enableObservability` to `PROTECTED_SETTING_KEYS`.
- Sensitive-key list is exactly: `authorization`, `x-api-key`, `cookie`, `token`, `api-key`, `set-cookie`, `x-goog-api-key`. Do not add `password` unless a later inspected payload requires it.
- Timeline replaces matching header/body values with `[redacted]` and keeps keys. `requestDetails` keeps deleting those keys.
- JavaScript only (`*.js`, `tests/unit/*.test.js`). No TypeScript.
- Conventional Commits; subject ≤ 100 characters. Docs + unit tests for every behavior change (`AGENTS.md`).
- Isolated worktree for implementation. Do not edit the dirty primary checkout.

## File map

Create:

- `src/lib/observability/redact.js`
- `src/lib/db/proxyTimelineDb.js`
- `src/lib/db/repos/proxyTimelineRepo.js`
- `open-sse/handlers/chatCore/proxyTimeline.js`
- `open-sse/handlers/chatCore/proxyTimelineFrame.js`
- `src/app/api/timeline/route.js`
- `src/app/api/timeline/[id]/route.js`
- `src/app/api/timeline/stream/route.js`
- `src/app/(dashboard)/dashboard/timeline/page.js`
- `src/app/(dashboard)/dashboard/timeline/[id]/page.js`
- `docs/features/proxy-timeline.md`
- `tests/unit/observability-key-migration.test.js`
- `tests/unit/proxy-timeline-settings.test.js`
- `tests/unit/proxy-timeline-redact.test.js`
- `tests/unit/proxy-timeline-repo.test.js`
- `tests/unit/proxy-timeline-frame.test.js`
- `tests/unit/proxy-timeline-api.test.js`
- `tests/unit/proxy-timeline-stream-tap.test.js`
- `tests/unit/proxy-timeline-view-all.test.js`

Modify:

- `src/lib/db/paths.js` — add `currentProxyTimelineFile()`
- `src/lib/db/repos/settingsRepo.js`
- `src/lib/db/repos/requestDetailsRepo.js`
- `src/app/api/settings/route.js`
- `src/app/(dashboard)/dashboard/profile/page.js`
- `src/dashboardGuard.js`
- `open-sse/utils/streamHandler.js`
- `open-sse/handlers/chatCore.js`
- `open-sse/handlers/chatCore/streamingHandler.js`
- `open-sse/handlers/chatCore/nonStreamingHandler.js`
- `open-sse/handlers/chatCore/sseToJsonHandler.js`
- `open-sse/services/accountFallback.js`
- `src/shared/components/SidebarNavIcons.js`
- `src/shared/components/Header.js`
- `src/app/(dashboard)/dashboard/providers/[id]/page.js`
- `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js`
- `tests/unit/sidebar-icons.test.js`
- `docs/guides/usage.md`
- `docs/README.md`
- `CHANGELOG.md`

---

### Task 1: Observability key fix and timeline settings

**Files:**
- Modify: `src/lib/db/repos/settingsRepo.js`
- Modify: `src/lib/db/repos/requestDetailsRepo.js`
- Modify: `src/app/api/settings/route.js`
- Test: `tests/unit/observability-key-migration.test.js`
- Test: `tests/unit/proxy-timeline-settings.test.js`

**Interfaces:**
- Consumes: `getSettings()`, `updateSettings(updates)`, `getSettingsSync()`, existing `DEFAULT_SETTINGS.enableObservability = true`.
- Produces: `enableProxyTimeline` default `false`; `proxyTimelineRetentionDays` default `1`; `getSettings()` never returns `enableObservability2`; `getObservabilityConfig()` reads `enableObservability`.

- [ ] **Step 1: Write the failing migration test**

Create `tests/unit/observability-key-migration.test.js` using the isolated `DATA_DIR` + `initDb` pattern from `tests/unit/hide-paid-models-settings-persist.test.js`.

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-obs-mig-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("enableObservability2 migration", () => {
  it("copies enableObservability2 only when enableObservability is absent", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify({ enableObservability2: false })],
    );
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    expect(settings.enableObservability).toBe(false);
    expect(settings).not.toHaveProperty("enableObservability2");
  });

  it("keeps enableObservability when both keys exist", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify({ enableObservability: true, enableObservability2: false })],
    );
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    expect(settings.enableObservability).toBe(true);
    expect(settings).not.toHaveProperty("enableObservability2");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/observability-key-migration.test.js`

Expected: FAIL because `getSettings()` still returns `enableObservability2` and `getObservabilityConfig` still prefers that key.

- [ ] **Step 3: Write the failing settings persist + validation test**

Create `tests/unit/proxy-timeline-settings.test.js` with the same temp-`DATA_DIR` setup. Assert:

- fresh `getSettings()` has `enableProxyTimeline === false` and `proxyTimelineRetentionDays === 1`
- PATCH `{ enableProxyTimeline: true, proxyTimelineRetentionDays: 7 }` then GET returns those values
- PATCH `{ proxyTimelineRetentionDays: 2 }` returns 400
- PATCH `{ enableProxyTimeline: "yes" }` returns 400

Copy the `vi.mock("next/server")` + real `@/lib/db` setup from `tests/unit/hide-paid-models-settings-persist.test.js`.

- [ ] **Step 4: Run it to make sure it fails**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/proxy-timeline-settings.test.js`

Expected: FAIL — keys missing from defaults; PATCH accepts any number.

- [ ] **Step 5: Implement the minimum settings + read-path fix**

In `src/lib/db/repos/settingsRepo.js` `DEFAULT_SETTINGS`, after `enableObservability: true,`:

```js
enableProxyTimeline: false,
proxyTimelineRetentionDays: 1,
```

In `mergeWithDefaults(raw)` and the `updateSettings` persist path, apply this once on the stored object before merge/write:

```js
function migrateObservabilityKeys(raw) {
  const next = { ...(raw || {}) };
  const hasCanonical = Object.prototype.hasOwnProperty.call(next, "enableObservability");
  const hasLegacy = Object.prototype.hasOwnProperty.call(next, "enableObservability2");
  if (!hasCanonical && hasLegacy && typeof next.enableObservability2 === "boolean") {
    next.enableObservability = next.enableObservability2;
  }
  delete next.enableObservability2;
  return next;
}
```

Call it in `readRaw` / `readRawSync` before `mergeWithDefaults`, and in `updateSettings` / `updateSettingsWithPasswordEpoch` on `current` before spreading `updates`. Persist the migrated object so the leftover key is dropped from sqlite.

In `requestDetailsRepo.js` `getObservabilityConfig`:

```js
const enabled = typeof settings.enableObservability === "boolean"
  ? settings.enableObservability
  : envEnabled;
```

In `src/app/api/settings/route.js`, immediately before `const willChangePassword = body.password !== undefined;`:

```js
if (Object.prototype.hasOwnProperty.call(body, "enableProxyTimeline")
    && typeof body.enableProxyTimeline !== "boolean") {
  return NextResponse.json({ error: "Invalid enableProxyTimeline" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
}
if (Object.prototype.hasOwnProperty.call(body, "proxyTimelineRetentionDays")) {
  const v = body.proxyTimelineRetentionDays;
  if (!Number.isInteger(v) || ![1, 3, 7].includes(v)) {
    return NextResponse.json({ error: "Invalid proxyTimelineRetentionDays" }, { status: 400, headers: SETTINGS_RESPONSE_HEADERS });
  }
}
```

Do **not** touch `PROTECTED_SETTING_KEYS`.

- [ ] **Step 6: Run both tests and make sure they pass**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/observability-key-migration.test.js unit/proxy-timeline-settings.test.js`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/repos/settingsRepo.js src/lib/db/repos/requestDetailsRepo.js src/app/api/settings/route.js tests/unit/observability-key-migration.test.js tests/unit/proxy-timeline-settings.test.js
git commit -m "fix(settings): migrate enableObservability2 and add timeline keys"
```

---

### Task 2: Shared redactor

**Files:**
- Create: `src/lib/observability/redact.js`
- Modify: `src/lib/db/repos/requestDetailsRepo.js` (`sanitizeHeaders`)
- Test: `tests/unit/proxy-timeline-redact.test.js`

**Interfaces:**
- Consumes: exact key-substring list from the spec.
- Produces: `SENSITIVE_KEY_PARTS`, `redactHeaders(headers, { keepKeys })`, `redactValue(value)`.

- [ ] **Step 1: Write the failing redaction test**

```js
import { describe, expect, it } from "vitest";
import { redactHeaders, redactValue } from "../../src/lib/observability/redact.js";

describe("timeline redaction", () => {
  it("replaces authorization value and keeps the key", () => {
    expect(redactHeaders({ Authorization: "Bearer secret", Accept: "text/event-stream" }, { keepKeys: true }))
      .toEqual({ Authorization: "[redacted]", Accept: "text/event-stream" });
  });

  it("deletes authorization when keepKeys is false", () => {
    expect(redactHeaders({ Authorization: "Bearer secret", Accept: "text/event-stream" }, { keepKeys: false }))
      .toEqual({ Accept: "text/event-stream" });
  });

  it("redacts sk- body tokens and api-key fields", () => {
    const out = redactValue({
      apiKey: "sk-abcdefgh",
      text: "token sk-abcdefgh and AIzaXXXX",
      nested: { "x-api-key": "abc" },
    });
    expect(JSON.stringify(out)).not.toMatch(/sk-abcdefgh|AIzaXXXX|abc/);
    expect(out.apiKey).toBe("[redacted]");
    expect(out.nested["x-api-key"]).toBe("[redacted]");
  });

  it("strips credential query parameters", () => {
    const out = redactValue("https://example.com/v1?key=secret&q=ok");
    expect(out).not.toContain("secret");
    expect(out).toContain("q=ok");
  });
});
```

Match on `authorization`, `x-api-key`, `cookie`, `token`, `api-key`, `set-cookie`, `x-goog-api-key` via `key.toLowerCase().includes(part)`. Also replace `Bearer <token>`, `sk-` / `sk_` runs, and `AIza` runs in strings.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/proxy-timeline-redact.test.js`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/lib/observability/redact.js`**

Export:

```js
export const SENSITIVE_KEY_PARTS = [
  "authorization",
  "x-api-key",
  "cookie",
  "token",
  "api-key",
  "set-cookie",
  "x-goog-api-key",
];

export function isSensitiveKey(key) {
  const lower = String(key).toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
}

export function redactHeaders(headers, { keepKeys = true } = {}) { /* ... */ }
export function redactValue(value) { /* recurse objects/arrays; rewrite strings */ }
```

Point `requestDetailsRepo.sanitizeHeaders` at `redactHeaders(headers, { keepKeys: false })`. Do not change truncation behaviour.

- [ ] **Step 4: Run the test and make sure it passes**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/proxy-timeline-redact.test.js`

Expected: PASS. Also run `unit/usage-request-details-validation.test.js` to confirm Details API still works.

- [ ] **Step 5: Commit**

```bash
git add src/lib/observability/redact.js src/lib/db/repos/requestDetailsRepo.js tests/unit/proxy-timeline-redact.test.js
git commit -m "feat(observability): share header and body redaction helper"
```

---

### Task 3: Sidecar store, bounded writer, retention

**Files:**
- Modify: `src/lib/db/paths.js`
- Create: `src/lib/db/proxyTimelineDb.js`
- Create: `src/lib/db/repos/proxyTimelineRepo.js`
- Test: `tests/unit/proxy-timeline-repo.test.js`

**Interfaces:**
- Consumes: `currentDbDir()`, `createBetterSqliteAdapter(file)` (and the same fallback order as `src/lib/db/driver.js`, pointed at the sidecar file). `PRAGMA_SQL` from `src/lib/db/schema.js`.
- Produces: `startTrace(fields)`, `record(traceId, event)`, `finishTrace(traceId, fields)`, `listTraces(filter)`, `getTrace(id)`, `clearTraces()`, `pruneExpired()`, `onTimelineWrite(listener)`, `QUEUE_CAP = 10000`, `FLUSH_BATCH = 50`.

- [ ] **Step 1: Write the failing repo test**

Use a temp `DATA_DIR`. After `vi.resetModules()`, import the repo and exercise:

1. `startTrace` + two `record` + `finishTrace` → `getTrace(id)` returns events in `seq` order.
2. `enableProxyTimeline: false` → `record` is a no-op (no row).
3. Capture on, then close the sidecar (`adapter.close()`) and call `record` / `startTrace` — must not throw.
4. Enqueue 60 events, flush once — sqlite has ≤ 50 new event rows; a second flush writes the rest.
5. Fill the queue to 10_000 `sse_chunk` events (do not flush), then `record` one more `sse_chunk` and one `error` hop. Queue length stays ≤ 10_000. After flush, some trace has `_dropped` > 0 and `truncated = 1`. The `error` hop is present.
6. Insert a trace with `started_at` 8 days ago, set `proxyTimelineRetentionDays = 7`, run `pruneExpired()` — old trace and its events are gone; a fresh trace stays.

Force-flush for tests via `export async function flushProxyTimelineForTests()`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/proxy-timeline-repo.test.js`

Expected: FAIL — modules missing.

- [ ] **Step 3: Implement path + sidecar + repo**

`src/lib/db/paths.js`:

```js
export function currentProxyTimelineFile() {
  return path.join(currentDbDir(), "proxy-timeline.sqlite");
}
```

`src/lib/db/proxyTimelineDb.js`: open `${currentProxyTimelineFile()}` with the same adapter fallbacks as `driver.js`, **without** `runMigrationOnce`. `exec` this schema (and `PRAGMA_SQL`):

```sql
CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT,
  provider TEXT,
  model TEXT,
  connection_id TEXT,
  api_key_id TEXT,
  endpoint TEXT,
  client_format TEXT,
  provider_format TEXT,
  fallback_count INTEGER NOT NULL DEFAULT 0,
  ttft_ms INTEGER,
  total_ms INTEGER,
  event_count INTEGER NOT NULL DEFAULT 0,
  payload_bytes INTEGER NOT NULL DEFAULT 0,
  redacted INTEGER NOT NULL DEFAULT 1,
  truncated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  t_ms INTEGER NOT NULL,
  type TEXT NOT NULL,
  direction TEXT NOT NULL,
  summary TEXT,
  payload TEXT,
  UNIQUE (trace_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_pt_started ON traces(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pt_provider ON traces(provider);
CREATE INDEX IF NOT EXISTS idx_pt_model ON traces(model);
CREATE INDEX IF NOT EXISTS idx_pt_conn ON traces(connection_id);
CREATE INDEX IF NOT EXISTS idx_pt_key ON traces(api_key_id);
CREATE INDEX IF NOT EXISTS idx_pt_status ON traces(status);
CREATE INDEX IF NOT EXISTS idx_pt_events ON events(trace_id, seq);
```

Never call the main migrator. Never copy this file into `db/backups/`.

`src/lib/db/repos/proxyTimelineRepo.js` implements the spec writer:

- `record` / `startTrace` / `finishTrace` only push the in-memory queue and return. They do not open SQLite.
- If `getSettingsSync().enableProxyTimeline !== true`, all three are no-ops.
- Queue cap 10_000 events or 32 MiB encoded. Overflow evicts oldest queued `sse_chunk` for hop events; extra `sse_chunk` increments per-trace `_dropped`. Persist `{ type: "sse_chunk", summary: "dropped N frames", payload: { _dropped: N } }` on the next flush that has room; set `traces.truncated`.
- Flush ≤ 50 rows per turn (`FLUSH_BATCH`), timer 250 ms or when 50 wait. `setImmediate` for the next batch. One `db.transaction` per flush.
- Payloads through `redactValue` before enqueue. 1 MiB encoded ceiling → `{ _truncated, _originalSize, _preview }` and `traces.truncated`.
- `pruneExpired`: delete `traces` where `started_at` < now − `proxyTimelineRetentionDays` days, then `DELETE FROM events WHERE trace_id NOT IN (SELECT id FROM traces)`. Hourly `setInterval`, `unref()`.
- `onTimelineWrite(listener)` used by the live SSE route. Fail-open: wrap every public function in try/catch.

- [ ] **Step 4: Run the test and make sure it passes**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/proxy-timeline-repo.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/paths.js src/lib/db/proxyTimelineDb.js src/lib/db/repos/proxyTimelineRepo.js tests/unit/proxy-timeline-repo.test.js
git commit -m "feat(timeline): add sidecar store with bounded writer"
```

---

### Task 4: Incremental client-frame framer

**Files:**
- Create: `open-sse/handlers/chatCore/proxyTimelineFrame.js`
- Test: `tests/unit/proxy-timeline-frame.test.js`

**Interfaces:**
- Consumes: arbitrary `Uint8Array` / `string` chunks; client format (`sse` vs `ndjson`).
- Produces: `createClientFrameFramer({ format, onFrame })` with `push(chunk)` and `flush()`.

- [ ] **Step 1: Write the failing framer test**

```js
import { describe, expect, it } from "vitest";
import { createClientFrameFramer } from "../../open-sse/handlers/chatCore/proxyTimelineFrame.js";

describe("createClientFrameFramer", () => {
  it("finalizes repo passthrough data lines without a blank delimiter", () => {
    const frames = [];
    const framer = createClientFrameFramer({ format: "sse", onFrame: (f) => frames.push(f) });
    framer.push(Buffer.from("data: {\"x\":1}\n"));
    framer.push(Buffer.from("data: {\"x\":2}\n"));
    expect(frames).toEqual(["data: {\"x\":1}", "data: {\"x\":2}"]);
  });

  it("pairs event and data lines then also accepts blank-delimited frames", () => {
    const frames = [];
    const framer = createClientFrameFramer({ format: "sse", onFrame: (f) => frames.push(f) });
    framer.push(Buffer.from("event: message_start\ndata: {\"type\":\"message_start\"}\n"));
    framer.push(Buffer.from("data: {\"x\":3}\n\n"));
    expect(frames).toEqual([
      "event: message_start\ndata: {\"type\":\"message_start\"}",
      "data: {\"x\":3}",
    ]);
  });

  it("does not emit a split data line until the newline arrives", () => {
    const frames = [];
    const framer = createClientFrameFramer({ format: "sse", onFrame: (f) => frames.push(f) });
    framer.push(Buffer.from("data: {\"x\":1}"));
    expect(frames).toEqual([]);
    framer.push(Buffer.from("\n"));
    expect(frames).toEqual(["data: {\"x\":1}"]);
  });

  it("flushes a trailing partial record at EOF", () => {
    const frames = [];
    const framer = createClientFrameFramer({ format: "sse", onFrame: (f) => frames.push(f) });
    framer.push(Buffer.from("data: leftover"));
    framer.flush();
    expect(frames).toEqual(["data: leftover"]);
  });

  it("splits Ollama NDJSON on newlines", () => {
    const frames = [];
    const framer = createClientFrameFramer({ format: "ndjson", onFrame: (f) => frames.push(f) });
    framer.push(Buffer.from("{\"a\":1}\n{\"a\":2}\n"));
    expect(frames).toEqual(['{"a":1}', '{"a":2}']);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/proxy-timeline-frame.test.js`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the framer**

Do **not** wait only for `\\n\\n`. Passthrough in
`open-sse/utils/stream.js` emits `data: ...\\n` and drops blank lines.

- SSE: keep an optional pending `event:` line; finalize when the next
  complete `data:` line arrives. Also finalize on a blank line
  (`\\n\\n` / `\\r\\n\\r\\n`) so `formatSSE` output still splits.
  Decode with `TextDecoder({ stream: true })`.
- NDJSON: finalize on each newline.
- `push` emits zero-or-more complete records and keeps the tail.
- `flush` emits a non-empty tail.
- Never assume one `push` = one frame.

- [ ] **Step 4: Run the test and make sure it passes**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/proxy-timeline-frame.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add open-sse/handlers/chatCore/proxyTimelineFrame.js tests/unit/proxy-timeline-frame.test.js
git commit -m "feat(timeline): frame client SSE and NDJSON incrementally"
```

---

### Task 5: Stream tap and chatCore emit sites

**Files:**
- Create: `open-sse/handlers/chatCore/proxyTimeline.js`
- Modify: `open-sse/utils/streamHandler.js`
- Modify: `open-sse/handlers/chatCore/streamingHandler.js`
- Modify: `open-sse/handlers/chatCore.js`
- Modify: `open-sse/handlers/chatCore/nonStreamingHandler.js`
- Modify: `open-sse/handlers/chatCore/sseToJsonHandler.js`
- Modify: `open-sse/services/accountFallback.js`
- Test: `tests/unit/proxy-timeline-stream-tap.test.js`

**Interfaces:**
- Consumes: `startTrace` / `record` / `finishTrace` from the repo; `createClientFrameFramer`; `createDisconnectAwareStream`.
- Produces: `onClientBytes` / `onClientEnd` / `onClientAbort` invoked
  from `createDisconnectAwareStream`. `onClientBytes` on every
  `controller.enqueue` (upstream value, `emitTerminal` bytes,
  `emitClientRecovery` bytes). `onClientEnd` on clean EOF after the
  last enqueue. `onClientAbort` on error, stall, disconnect, or cancel
  after the last enqueue. Original bytes still enqueue immediately.

- [ ] **Step 1: Write the failing tap test**

Spy `createDisconnectAwareStream` by importing it and driving a tiny `ReadableStream` of split SSE bytes plus a synthesized abort payload. Assert:

- `onClientBytes` is called with the raw enqueued bytes (including abort bytes).
- `onClientEnd` runs on clean EOF and `onClientAbort` runs on
  `controller.error` / cancel; both `flush()` the framer so a trailing
  partial record is stored.
- After framing, `record` received two complete `sse_chunk` events plus
  the flushed abort or trailing record.
- The readable still yields the original bytes (client stream unchanged).
- `record` throwing does not reject the readable.

Also assert `handleStreamingResponse` passes `onClientBytes`,
`onClientEnd`, and `onClientAbort` into `pipeWithDisconnect` /
`createDisconnectAwareStream` (inspect the call, do not re-implement
the handler).

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/proxy-timeline-stream-tap.test.js`

Expected: FAIL — `onClientBytes` / `onClientEnd` / `onClientAbort` do
not exist; `chatCore.js` does not call `startTrace`.

- [ ] **Step 3: Implement emit + tap**

`open-sse/handlers/chatCore/proxyTimeline.js` re-exports repo functions and a helper:

```js
export function attachClientFrameTap(traceId, format) {
  const framer = createClientFrameFramer({
    format,
    onFrame: (payload) => record(traceId, { type: "sse_chunk", direction: "out", payload }),
  });
  return {
    onClientBytes(chunk) { try { framer.push(chunk); } catch { /* fail-open */ } },
    onClientEnd() { try { framer.flush(); } catch { /* fail-open */ } },
    onClientAbort() { try { framer.flush(); } catch { /* fail-open */ } },
  };
}
```

`createDisconnectAwareStream(transformStream, streamController, onAbortTerminal, terminalTracker, onClientBytes = null, onClientEnd = null, onClientAbort = null)`:

```js
const forward = (controller, bytes) => {
  try { onClientBytes?.(bytes); } catch { /* fail-open */ }
  controller.enqueue(bytes);
};
const end = () => { try { onClientEnd?.(); } catch { /* fail-open */ } };
const abort = () => { try { onClientAbort?.(); } catch { /* fail-open */ } };
```

Use `forward` in the `value` path, `emitTerminal`, and
`emitClientRecovery`. Call `end()` on the `done` path after any
recovery enqueue. Call `abort()` on `handleError`, network-close
recovery, `cancel`, and stall abort, after any synthesized bytes.
Never rely on the tap owner to flush without these callbacks.

`pipeWithDisconnect` takes the three callbacks and passes them through.

`handleStreamingResponse` creates the tap with client format
(`emittedFormat === FORMATS.OLLAMA ? "ndjson" : "sse"`) and passes
`onClientBytes`, `onClientEnd`, `onClientAbort`.

`chatCore.js` **must** call `startTrace` at ingress (provider, model, connectionId, api_key_id, endpoint, formats) and `record` for auth / route / error / abort. `finishTrace` on non-stream terminals. `nonStreamingHandler.js` and `sseToJsonHandler.js` call `finishTrace` next to existing `saveRequestDetail`. `accountFallback.js` calls `record(traceId, { type: "fallback", direction: "internal", summary })` on each account hop. Thread `traceId` the same way `streamDetailId` is already threaded.

`saveRequestDetail` stays. Timeline does not read `requestDetails`.

- [ ] **Step 4: Run the test and make sure it passes**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/proxy-timeline-stream-tap.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add open-sse/handlers/chatCore/proxyTimeline.js open-sse/utils/streamHandler.js open-sse/handlers/chatCore/streamingHandler.js open-sse/handlers/chatCore.js open-sse/handlers/chatCore/nonStreamingHandler.js open-sse/handlers/chatCore/sseToJsonHandler.js open-sse/services/accountFallback.js tests/unit/proxy-timeline-stream-tap.test.js
git commit -m "feat(timeline): emit hops and framed client bytes"
```

---

### Task 6: Timeline HTTP API

**Files:**
- Create: `src/app/api/timeline/route.js`
- Create: `src/app/api/timeline/[id]/route.js`
- Create: `src/app/api/timeline/stream/route.js`
- Modify: `src/dashboardGuard.js` (`PROTECTED_API_PATHS`, after `"/api/usage"`)
- Test: `tests/unit/proxy-timeline-api.test.js`

**Interfaces:**
- Consumes: `listTraces`, `getTrace`, `clearTraces`, `onTimelineWrite`.
- Produces: `GET /api/timeline`, `DELETE /api/timeline`, `GET /api/timeline/:id`, `GET /api/timeline/stream`.

- [ ] **Step 1: Write the failing API test**

Copy the mock style in `tests/unit/usage-request-details-validation.test.js`.

- `pageSize=101` and `page=0` → 400, repo not called
- accepted filters: `provider`, `model`, `connectionId`, `apiKeyId`, `status`, `endpoint`, `startDate`, `endDate`, `q`
- reject `connection` (the non-canonical name) by simply not reading it — assert repo called without `connection`
- `GET /api/timeline/:id` returns `{ trace, events }` in `seq` order
- `DELETE /api/timeline` calls `clearTraces`
- `GET /api/timeline/stream` returns `text/event-stream`

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/proxy-timeline-api.test.js`

Expected: FAIL — routes missing.

- [ ] **Step 3: Implement the three routes**

`GET /api/timeline`: same page/pageSize bounds as `src/app/api/usage/request-details/route.js` (page ≥ 1, pageSize 1–100, default 20). Query names are the camelCase spec names only.

`GET /api/timeline/[id]`: 404 if missing.

`DELETE /api/timeline`: `{ ok: true }`.

`GET /api/timeline/stream`: copy the abort + keepalive skeleton from `src/app/api/usage/stream/route.js`. Subscribe to `onTimelineWrite`. Emit `data: ${JSON.stringify({ type: "trace"|"event", ... })}\n\n`. Apply the same list filters. `dynamic = "force-dynamic"`.

Add `"/api/timeline"` to `PROTECTED_API_PATHS` in `src/dashboardGuard.js` next to `"/api/usage"`.

- [ ] **Step 4: Run the test and make sure it passes**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/proxy-timeline-api.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/timeline src/dashboardGuard.js tests/unit/proxy-timeline-api.test.js
git commit -m "feat(timeline): add dashboard list, detail, stream, and clear API"
```

---

### Task 7: Dashboard pages, nav, settings UI, View all

**Files:**
- Modify: `src/shared/components/SidebarNavIcons.js`
- Modify: `src/shared/components/Header.js`
- Modify: `tests/unit/sidebar-icons.test.js`
- Modify: `src/app/(dashboard)/dashboard/profile/page.js`
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/page.js`
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js`
- Create: `src/app/(dashboard)/dashboard/timeline/page.js`
- Create: `src/app/(dashboard)/dashboard/timeline/[id]/page.js`
- Create: `src/app/(dashboard)/dashboard/timeline/href.js`
- Test: `tests/unit/proxy-timeline-view-all.test.js`

**Interfaces:**
- Consumes: `/api/timeline`, `/api/timeline/stream`, `/api/timeline/:id`, `/api/settings`.
- Produces: nav item `{ href: "/dashboard/timeline", label: "Timeline", icon: "timeline" }` immediately after Usage; View all hrefs from the spec.

- [ ] **Step 1: Extend the existing nav test so it fails**

In `tests/unit/sidebar-icons.test.js` `maps top nav labels to expected icon glyphs`:

```js
expect(map.get("Timeline")).toBe("timeline");
```

Assert `navItems[1].href === "/dashboard/timeline"` (Usage remains `[0]`).

Create `tests/unit/proxy-timeline-view-all.test.js`:

```js
import { describe, expect, it } from "vitest";
import { buildTimelineHref } from "../../src/app/(dashboard)/dashboard/timeline/href.js";

describe("buildTimelineHref", () => {
  it("builds provider View all", () => {
    expect(buildTimelineHref({ provider: "openai" })).toBe("/dashboard/timeline?provider=openai");
  });
  it("builds connection View all with connectionId", () => {
    expect(buildTimelineHref({ provider: "openai", connectionId: "c1" }))
      .toBe("/dashboard/timeline?provider=openai&connectionId=c1");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/sidebar-icons.test.js unit/proxy-timeline-view-all.test.js`

Expected: FAIL — Timeline missing; helper missing.

- [ ] **Step 3: Implement nav, header, settings, pages, View all**

`src/app/(dashboard)/dashboard/timeline/href.js`:

```js
export function buildTimelineHref({ provider, connectionId } = {}) {
  const q = new URLSearchParams();
  if (provider) q.set("provider", provider);
  if (connectionId) q.set("connectionId", connectionId);
  const s = q.toString();
  return s ? `/dashboard/timeline?${s}` : "/dashboard/timeline";
}
```

`SidebarNavIcons.js` `navItems`:

```js
{ href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
{ href: "/dashboard/timeline", label: "Timeline", icon: "timeline" },
```

`Header.js` `getPageInfo`, after the `/usage` block, handle `/timeline/[id]` then `/timeline` (same breadcrumb style as Providers / `{name}`).

Profile observability card (`src/app/(dashboard)/dashboard/profile/page.js` ~1253): keep the existing Request details toggle bound to `enableObservability`. Add a **Proxy timeline** `Toggle` bound to `enableProxyTimeline` (PATCH `{ enableProxyTimeline }`). Add a retention `<select>` of 1 / 3 / 7, disabled when timeline is off, PATCH `{ proxyTimelineRetentionDays: Number(value) }`. Note: sidecar `${DATA_DIR}/db/proxy-timeline.sqlite`, not in backups, secrets redacted.

`/dashboard/timeline/page.js`: query string is the filter source of truth (`provider`, `model`, `connectionId`, `apiKeyId`, `status`, `endpoint`, `startDate`, `endDate`). Live toggle opens `EventSource("/api/timeline/stream?" + params)`. Table columns from the spec. Empty: capture off → link `/dashboard/profile`; capture on, no rows → "waiting for a call".

`/dashboard/timeline/[id]/page.js`: oldest-first hop list. Collapse consecutive `sse_chunk` as "N chunks"; expand to each redacted payload. Copy-as-JSON of the stored trace.

Provider header (`page.js` 1581–1587), next to Back:

```jsx
<Link
  href={buildTimelineHref({ provider: providerId })}
  className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4 ml-4"
>
  View all
</Link>
```

`ConnectionRow.js` actions row (~232): add a `View all` link to `buildTimelineHref({ provider: providerId, connectionId: connection.id })`. Pass `providerId` into `ConnectionRow` from the detail page. Do **not** add View all on the providers grid card.

- [ ] **Step 4: Run the nav / href tests and make sure they pass**

Run: `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/sidebar-icons.test.js unit/proxy-timeline-view-all.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/components/SidebarNavIcons.js src/shared/components/Header.js src/app/(dashboard)/dashboard/profile/page.js src/app/(dashboard)/dashboard/providers/[id]/page.js src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js src/app/(dashboard)/dashboard/timeline tests/unit/sidebar-icons.test.js tests/unit/proxy-timeline-view-all.test.js
git commit -m "feat(timeline): add dashboard page, settings, and View all"
```

---

### Task 8: Docs and changelog

**Files:**
- Create: `docs/features/proxy-timeline.md`
- Modify: `docs/guides/usage.md` (Dashboard Areas table)
- Modify: `docs/README.md` (Operators list, after Usage and Quota Tracking)
- Modify: `CHANGELOG.md` Unreleased

**Interfaces:**
- Consumes: spec settings, sidecar path, redaction, View all hrefs.
- Produces: operator-facing docs.

- [ ] **Step 1: Write `docs/features/proxy-timeline.md`**

Cover: default off; `enableProxyTimeline`; retention 1/3/7 days; sidecar path; not in backups; secrets always `[redacted]`; live tail; provider View all; Usage → Details still exists.

- [ ] **Step 2: Link it**

`docs/guides/usage.md` table row:

`| Timeline | Live tail and hop/SSE history for proxy calls. |`

`docs/README.md` Operators list: `[Proxy Timeline](features/proxy-timeline.md)`.

`CHANGELOG.md` Unreleased: mention the page, settings, View all, and the `enableObservability` key fix.

- [ ] **Step 3: Run docs check**

Run: `npm run check:docs`

Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add docs/features/proxy-timeline.md docs/guides/usage.md docs/README.md CHANGELOG.md
git commit -m "docs(timeline): document proxy timeline capture and settings"
```

---

### Task 9: Verification

- [ ] **Step 1: Focused tests**

```bash
cd tests && ./node_modules/.bin/vitest run --config vitest.config.js \
  unit/observability-key-migration.test.js \
  unit/proxy-timeline-settings.test.js \
  unit/proxy-timeline-redact.test.js \
  unit/proxy-timeline-repo.test.js \
  unit/proxy-timeline-frame.test.js \
  unit/proxy-timeline-stream-tap.test.js \
  unit/proxy-timeline-api.test.js \
  unit/sidebar-icons.test.js \
  unit/proxy-timeline-view-all.test.js
```

Expected: all PASS

- [ ] **Step 2: Repo gates**

```bash
npm run lint
npm run check:docs
npx commitlint --from=origin/main --to=HEAD
```

Expected: exit 0. Do not grow `tests/__baseline__/known-fails.txt`.

- [ ] **Step 3: Spec coverage check (human / reviewer)**

Every spec section has a task: settings + migration (1), sidecar + writer + retention (3), redaction (2), framer + `onClientBytes` (4–5), chatCore emit (5), HTTP API including DELETE (6), UI / View all / settings card (7), docs (8).

---

## Self-review

1. **Spec coverage:** settings keys and `enableObservability2` migration → Task 1. Redaction + Details delete semantics → Task 2. Sidecar, 50-row flush, hop-priority overflow, retention 1/3/7 → Task 3. Incremental framer → Task 4. `onClientBytes` including abort/recovery + chatCore hooks → Task 5. List/detail/stream/DELETE + dashboardGuard → Task 6. Nav, pages, profile, View all → Task 7. Docs → Task 8.
2. **Placeholders:** none. Commands, files, and interfaces are named.
3. **Types:** `enableProxyTimeline`, `proxyTimelineRetentionDays`, `connectionId`, `onClientBytes`, `startTrace` / `record` / `finishTrace` are consistent across tasks. No TypeScript. No nested settings. No `PROTECTED_SETTING_KEYS` change.
