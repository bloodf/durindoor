// Local Files + Batches service.
//
// ponytail: local batch engine, upgrade path = provider-native batch passthrough per-provider.
//
// Files: <filesRoot>/<id>/content + sibling meta.json. Batches: in-memory
// registry (process lifetime); row results stream to output/error JSONL files
// which are themselves registered as file objects (single source of bytes).
//
// Two wire surfaces, ONE runner, injected executor (no real provider in tests):
//   OpenAI:    /v1/files, /v1/batches         rows {custom_id,method,url,body}
//   Anthropic: /v1/messages/batches            rows {custom_id,params}

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const APP_DIRNAME = ".9router";

// Generated ids look like "<prefix>_<24 hex>". Any caller-supplied id MUST
// match this charset or it is rejected before touching the filesystem — this
// is the only thing standing between a caller and path traversal out of root.
const SAFE_ID = /^(file|batch|msgbatch|req|batchreq)_[0-9a-f]{24}$/;

const batches = new Map(); // process-lifetime registry

const nowSeconds = () => Math.floor(Date.now() / 1000);
const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
const resolveRoot = (filesRoot) => filesRoot || path.join(os.homedir(), APP_DIRNAME, "files");

function assertSafeId(id) {
  if (typeof id !== "string" || !SAFE_ID.test(id)) {
    const e = new Error("invalid id");
    e.statusCode = 400;
    throw e;
  }
  return id;
}

const fileDir = (root, id) => path.join(root, id);
const contentPath = (root, id) => path.join(fileDir(root, id), "content");
const metaPath = (root, id) => path.join(fileDir(root, id), "meta.json");

function statusError(message, statusCode) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

function readMeta(root, id) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(root, id), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Upload a file. bytes is Buffer/Uint8Array/string.
 * @returns {{id,object:'file',bytes,created_at,filename,purpose}}
 */
export async function uploadFile({ filename, bytes, purpose }, { filesRoot } = {}) {
  const root = resolveRoot(filesRoot);
  if (typeof filename !== "string" || !filename) throw statusError("filename is required", 400);
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? "");
  const id = newId("file");
  fs.mkdirSync(fileDir(root, id), { recursive: true });
  fs.writeFileSync(contentPath(root, id), buf);
  const meta = {
    id,
    object: "file",
    bytes: buf.length,
    created_at: nowSeconds(),
    filename,
    purpose: purpose || "batch",
  };
  fs.writeFileSync(metaPath(root, id), JSON.stringify(meta));
  return meta;
}

export async function getFile(id, { filesRoot } = {}) {
  assertSafeId(id);
  return readMeta(resolveRoot(filesRoot), id);
}

export async function getFileContent(id, { filesRoot } = {}) {
  assertSafeId(id);
  const root = resolveRoot(filesRoot);
  const meta = readMeta(root, id);
  if (!meta) return null;
  let buffer;
  try {
    buffer = fs.readFileSync(contentPath(root, id));
  } catch {
    return null;
  }
  return { meta, buffer };
}

export async function listFiles({ filesRoot } = {}) {
  const root = resolveRoot(filesRoot);
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { object: "list", data: [] };
  }
  const data = [];
  for (const e of entries) {
    if (!e.isDirectory() || !SAFE_ID.test(e.name)) continue;
    const m = readMeta(root, e.name);
    if (m) data.push(m);
  }
  data.sort((a, b) => b.created_at - a.created_at);
  return { object: "list", data };
}

export async function deleteFile(id, { filesRoot } = {}) {
  assertSafeId(id);
  const root = resolveRoot(filesRoot);
  const meta = readMeta(root, id);
  if (!meta) return null;
  try {
    fs.rmSync(fileDir(root, id), { recursive: true, force: true });
  } catch {
    return null;
  }
  return { id, object: "file", deleted: true };
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

const OPENAI_ALLOWED_URLS = new Set(["/v1/chat/completions", "/v1/messages", "/v1/embeddings"]);

/** OpenAI input JSONL → normalized rows {custom_id,method,url,body}. */
export function validateOpenAIJsonl(text) {
  const rows = [];
  const errors = [];
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push({ line: i + 1, error: "invalid JSON" });
      continue;
    }
    const { custom_id, method, url, body } = parsed || {};
    if (typeof custom_id !== "string" || !custom_id) {
      errors.push({ line: i + 1, error: "custom_id required" });
      continue;
    }
    if (method !== "POST") {
      errors.push({ line: i + 1, custom_id, error: "method must be POST" });
      continue;
    }
    if (!OPENAI_ALLOWED_URLS.has(url)) {
      errors.push({ line: i + 1, custom_id, error: `unsupported url ${url}` });
      continue;
    }
    if (!body || typeof body !== "object") {
      errors.push({ line: i + 1, custom_id, error: "body required" });
      continue;
    }
    rows.push({ custom_id, method, url, body });
  }
  return { rows, errors };
}

/** Anthropic {requests:[{custom_id,params}]} → normalized rows (POST /v1/messages). */
export function validateAnthropicRequests(requests) {
  const rows = [];
  const errors = [];
  if (!Array.isArray(requests)) return { rows, errors: [{ error: "requests must be an array" }] };
  for (let i = 0; i < requests.length; i++) {
    const r = requests[i];
    if (!r || typeof r.custom_id !== "string" || !r.custom_id) {
      errors.push({ line: i + 1, error: "custom_id required" });
      continue;
    }
    if (!r.params || typeof r.params !== "object") {
      errors.push({ line: i + 1, custom_id: r.custom_id, error: "params required" });
      continue;
    }
    rows.push({ custom_id: r.custom_id, method: "POST", url: "/v1/messages", body: r.params });
  }
  return { rows, errors };
}

function openAIPublicView(b) {
  return {
    id: b.id,
    object: "batch",
    endpoint: b.endpoint,
    errors: b.errors?.length ? { object: "list", data: b.errors } : null,
    input_file_id: b.input_file_id,
    completion_window: b.completion_window,
    status: b.status,
    output_file_id: b.output_file_id,
    error_file_id: b.error_file_id,
    created_at: b.created_at,
    in_progress_at: b.in_progress_at,
    expires_at: b.expires_at,
    finalizing_at: b.finalizing_at,
    completed_at: b.completed_at,
    failed_at: b.failed_at,
    expired_at: b.expired_at,
    cancelling_at: b.cancelling_at,
    cancelled_at: b.cancelled_at,
    request_counts: b.request_counts,
    metadata: b.metadata,
  };
}

function anthropicStatus(b) {
  if (b.status === "cancelling") return "canceling";
  if (b.status === "completed" || b.status === "failed" || b.status === "cancelled") return "ended";
  if (b.status === "expired") return "expired";
  return "in_progress";
}

function anthropicPublicView(b) {
  const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);
  const ended = b.status === "completed" || b.status === "failed" || b.status === "cancelled";
  return {
    id: b.id,
    type: "message_batch",
    processing_status: anthropicStatus(b),
    request_counts: {
      processing: b.request_counts.total - b.request_counts.completed - b.request_counts.failed - (b.request_counts.canceled || 0),
      succeeded: b.request_counts.completed,
      errored: b.request_counts.failed,
      canceled: b.request_counts.canceled || 0,
      expired: 0,
    },
    ended_at: ended ? iso(b.completed_at || b.cancelled_at) : null,
    created_at: iso(b.created_at),
    expires_at: iso(b.expires_at),
    cancel_initiated_at: iso(b.cancelling_at),
    results_url: ended ? `/v1/messages/batches/${b.id}/results` : null,
  };
}

/** Register already-written JSONL bytes as a file object; return its id. */
async function registerResultsFile(id, suffix, lines, root) {
  if (!lines.length) return null;
  const buf = Buffer.from(lines.join("\n") + "\n");
  const meta = await uploadFile({ filename: `${id}-${suffix}.jsonl`, bytes: buf, purpose: `batch_${suffix}` }, { filesRoot: root });
  return meta.id;
}

/** One runner for both surfaces. Bounded concurrency; honors cancelRequested. */
async function runBatch(id, { filesRoot, executor, concurrency = 2 } = {}) {
  const b = batches.get(id);
  if (!b) return;
  const root = resolveRoot(filesRoot);

  b.status = "in_progress";
  b.in_progress_at = nowSeconds();

  const outRecords = [];
  const errRecords = [];
  let cursor = 0;
  let active = 0;
  const inFlight = new Set();

  const runOne = async (row, index) => {
    if (b.cancelRequested) return;
    active++;
    const request_id = newId("req");
    try {
      const res = await executor({ url: row.url, method: row.method, body: row.body, custom_id: row.custom_id });
      const line = JSON.stringify({
        id: newId("batchreq"),
        custom_id: row.custom_id,
        response: { status_code: res?.status_code ?? 200, request_id, body: res?.body ?? null },
        error: null,
      });
      outRecords.push({ index, line });
      b.request_counts.completed++;
    } catch (err) {
      const line = JSON.stringify({
        id: newId("batchreq"),
        custom_id: row.custom_id,
        response: null,
        error: { type: "error", error: { type: err?.type || "api_error", message: err?.message || String(err) } },
      });
      errRecords.push({ index, line });
      b.request_counts.failed++;
    } finally {
      active--;
    }
  };

  while (cursor < b.rows.length && !b.cancelRequested) {
    while (active >= concurrency && !b.cancelRequested) await new Promise((r) => setImmediate(r));
    if (b.cancelRequested) break;
    const index = cursor;
    const row = b.rows[cursor++];
    const p = runOne(row, index).finally(() => inFlight.delete(p));
    inFlight.add(p);
  }
  await Promise.all([...inFlight]); // finish the active row(s) before finalizing

  outRecords.sort((a, b) => a.index - b.index);
  errRecords.sort((a, b) => a.index - b.index);
  b.output_file_id = await registerResultsFile(id, "output", outRecords.map((r) => r.line), root);
  b.error_file_id = await registerResultsFile(id, "error", errRecords.map((r) => r.line), root);
  b.finalizing_at = nowSeconds();

  const { total, completed, failed } = b.request_counts;
  if (b.cancelRequested) {
    b.status = "cancelled";
    b.cancelled_at = nowSeconds();
    b.request_counts.canceled = total - completed - failed;
  } else if (failed > 0 && completed === 0) {
    b.status = "failed";
    b.failed_at = nowSeconds();
    b.completed_at = nowSeconds();
  } else {
    b.status = "completed";
    b.completed_at = nowSeconds();
  }
}

function newBatchRecord({ surface, id, endpoint, input_file_id, rows, metadata }) {
  const created = nowSeconds();
  return {
    surface,
    id,
    endpoint,
    input_file_id,
    completion_window: "24h",
    status: "validating",
    output_file_id: null,
    error_file_id: null,
    created_at: created,
    in_progress_at: null,
    expires_at: created + 24 * 3600,
    finalizing_at: null,
    completed_at: null,
    failed_at: null,
    expired_at: null,
    cancelling_at: null,
    cancelled_at: null,
    request_counts: { total: rows.length, completed: 0, failed: 0, canceled: 0 },
    metadata: metadata || null,
    errors: null,
    rows,
    cancelRequested: false,
    _runner: null,
  };
}

function startBatch(b, { filesRoot, executor, concurrency }) {
  batches.set(b.id, b);
  // Defer the runner one microtask so create*Batch returns the validating view
  // before runBatch flips status to in_progress.
  b._runner = Promise.resolve()
    .then(() => runBatch(b.id, { filesRoot, executor, concurrency }))
    .catch((err) => {
    b.status = "failed";
    b.failed_at = nowSeconds();
    b.completed_at = nowSeconds();
    b.errors = [{ message: err?.message || String(err) }];
  });
  return b;
}

/** Create + start an OpenAI batch from an uploaded input file id. */
export async function createOpenAIBatch({ input_file_id, endpoint, completion_window = "24h", metadata }, { filesRoot, executor, concurrency } = {}) {
  assertSafeId(input_file_id);
  if (completion_window !== "24h") throw statusError("completion_window must be '24h'", 400);
  const file = await getFileContent(input_file_id, { filesRoot });
  if (!file) throw statusError("input_file not found", 404);
  const { rows, errors } = validateOpenAIJsonl(file.buffer.toString("utf8"));
  if (errors.length) {
    const e = statusError(`invalid input file: ${errors[0].error}`, 400);
    e.details = errors;
    throw e;
  }
  if (!rows.length) throw statusError("input file has no valid requests", 400);
  const endpointUrl = endpoint || "/v1/chat/completions";
  if (!OPENAI_ALLOWED_URLS.has(endpointUrl)) throw statusError(`unsupported endpoint ${endpointUrl}`, 400);
  for (const r of rows) {
    if (r.url !== endpointUrl) throw statusError(`row ${r.custom_id} url ${r.url} does not match endpoint ${endpointUrl}`, 400);
  }
  const b = newBatchRecord({ surface: "openai", id: newId("batch"), endpoint: endpointUrl, input_file_id, rows, metadata });
  b.completion_window = completion_window;
  return openAIPublicView(startBatch(b, { filesRoot, executor, concurrency }));
}

/** Create + start an Anthropic batch from {requests:[{custom_id,params}]}. */
export async function createAnthropicBatch({ requests }, { filesRoot, executor, concurrency } = {}) {
  const { rows, errors } = validateAnthropicRequests(requests);
  if (errors.length) {
    const e = statusError(`invalid requests: ${errors[0].error}`, 400);
    e.details = errors;
    throw e;
  }
  if (!rows.length) throw statusError("requests has no valid entries", 400);
  const b = newBatchRecord({ surface: "anthropic", id: newId("msgbatch"), endpoint: "/v1/messages", input_file_id: null, rows, metadata: null });
  return anthropicPublicView(startBatch(b, { filesRoot, executor, concurrency }));
}

export async function getBatch(id, { filesRoot, surface } = {}) {
  assertSafeId(id);
  const b = batches.get(id);
  if (!b) return null;
  if (surface && b.surface !== surface) return null;
  return b.surface === "anthropic" ? anthropicPublicView(b) : openAIPublicView(b);
}

export async function listBatches({ filesRoot, surface } = {}) {
  const data = [];
  for (const b of batches.values()) {
    if (surface && b.surface !== surface) continue;
    data.push(b.surface === "anthropic" ? anthropicPublicView(b) : openAIPublicView(b));
  }
  data.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return { object: "list", data, has_more: false };
}

export async function cancelBatch(id, { filesRoot, surface } = {}) {
  assertSafeId(id);
  const b = batches.get(id);
  if (!b) return null;
  if (surface && b.surface !== surface) return null;
  const terminal = ["completed", "failed", "cancelled", "expired"];
  if (!terminal.includes(b.status)) {
    b.cancelRequested = true;
    if (b.status === "in_progress" || b.status === "validating") {
      b.status = "cancelling";
      b.cancelling_at = nowSeconds();
    }
    if (b._runner) {
      try { await b._runner; } catch { /* runner finalizes */ }
    }
  }
  return b.surface === "anthropic" ? anthropicPublicView(b) : openAIPublicView(b);
}

/** Output/error JSONL text for an OpenAI batch (which = "output" | "error"). */
export async function getBatchOutputText(id, which = "output", { filesRoot } = {}) {
  assertSafeId(id);
  const b = batches.get(id);
  if (!b) return null;
  const fileId = which === "error" ? b.error_file_id : b.output_file_id;
  if (!fileId) return null;
  const fc = await getFileContent(fileId, { filesRoot });
  return fc ? fc.buffer.toString("utf8") : null;
}

/** Anthropic results JSONL: {custom_id, result:{type:"succeeded"|"errored", message|error}}.
 *  Non-2xx status_code on an output record is an API error → errored.
 *  Order follows the original input row order (NOT grouped by outcome file).
 *  Returns null ONLY when the id is missing or not an Anthropic batch (route → 404).
 *  Throws 409 when the batch exists but has not reached a terminal status yet,
 *  so callers cannot read partial results mid-run (route → 4xx, distinct from 404). */
export async function getAnthropicResultsJsonl(id, { filesRoot } = {}) {
  assertSafeId(id);
  const b = batches.get(id);
  if (!b || b.surface !== "anthropic") return null;
  const terminal = ["completed", "failed", "cancelled", "expired"];
  if (!terminal.includes(b.status)) {
    throw statusError("message batch has not ended yet", 409);
  }
  // Index every written record by custom_id, regardless of which file it landed in.
  const byCustomId = new Map();
  const ingest = (text, fromErrorFile) => {
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      byCustomId.set(rec.custom_id, { rec, fromErrorFile });
    }
  };
  ingest(await getBatchOutputText(id, "output", { filesRoot }), false);
  ingest(await getBatchOutputText(id, "error", { filesRoot }), true);
  // Emit in original input order; rows that never produced a record (e.g. canceled
  // before running) are skipped — they have no result to report.
  const lines = [];
  for (const row of b.rows) {
    const hit = byCustomId.get(row.custom_id);
    if (!hit) continue;
    const { rec, fromErrorFile } = hit;
    const status = rec.response?.status_code;
    const isError = fromErrorFile || (typeof status === "number" && status >= 400);
    if (isError) {
      const errBody = fromErrorFile
        ? (rec.error?.error || { type: "api_error", message: "unknown" })
        : (rec.response?.body?.error || { type: "api_error", message: `HTTP ${status}` });
      lines.push(JSON.stringify({ custom_id: rec.custom_id, result: { type: "errored", error: errBody } }));
    } else {
      lines.push(JSON.stringify({ custom_id: rec.custom_id, result: { type: "succeeded", message: rec.response?.body ?? null } }));
    }
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

/** Test hook: await a batch runner to settle. */
export async function _waitForBatch(id) {
  const b = batches.get(id);
  if (b?._runner) {
    try { await b._runner; } catch { /* ignore */ }
  }
}

/** Test hook: clear the in-memory registry. */
export function _resetBatches() {
  batches.clear();
}
