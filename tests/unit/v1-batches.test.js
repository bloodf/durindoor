// Local /v1/files + /v1/batches (+ Anthropic /v1/messages/batches) — service-level
// tests with an injected executor. No real providers, no HTTP server.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  uploadFile, getFile, getFileContent, listFiles, deleteFile,
  createOpenAIBatch, createAnthropicBatch, getBatch, cancelBatch, listBatches,
  getBatchOutputText, getAnthropicResultsJsonl, validateOpenAIJsonl,
  _waitForBatch, _resetBatches,
} from "../../open-sse/services/localFilesBatches.js";

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2-files-"));
  _resetBatches();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const okExecutor = async ({ body, custom_id }) => ({
  status_code: 200,
  body: { id: "msg_x", echo: body?.messages?.[0]?.content ?? custom_id },
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

describe("files", () => {
  it("uploads, reads metadata + content, lists, deletes", async () => {
    const meta = await uploadFile({ filename: "in.jsonl", bytes: '{"a":1}\n', purpose: "batch" }, { filesRoot: tmp });
    expect(meta.id).toMatch(/^file_[0-9a-f]{24}$/);
    expect(meta.bytes).toBe(Buffer.byteLength('{"a":1}\n'));
    expect(meta.purpose).toBe("batch");

    const got = await getFile(meta.id, { filesRoot: tmp });
    expect(got.filename).toBe("in.jsonl");

    const content = await getFileContent(meta.id, { filesRoot: tmp });
    expect(content.buffer.toString()).toBe('{"a":1}\n');

    const list = await listFiles({ filesRoot: tmp });
    expect(list.data).toHaveLength(1);

    const del = await deleteFile(meta.id, { filesRoot: tmp });
    expect(del.deleted).toBe(true);
    expect(await getFile(meta.id, { filesRoot: tmp })).toBeNull();
  });

  it("rejects path-traversal ids before touching the fs", async () => {
    await expect(getFile("../../etc/passwd", { filesRoot: tmp })).rejects.toThrow(/invalid id/);
    await expect(deleteFile("../x", { filesRoot: tmp })).rejects.toThrow(/invalid id/);
    await expect(getFileContent("file_NOTHEX", { filesRoot: tmp })).rejects.toThrow(/invalid id/);
  });

  it("returns null for missing file", async () => {
    expect(await getFile("file_" + "0".repeat(24), { filesRoot: tmp })).toBeNull();
  });

  it("isolates file metadata, content, listing, and deletion by stable owner", async () => {
    const meta = await uploadFile({ filename: "private.jsonl", bytes: "secret", purpose: "batch" }, { filesRoot: tmp, ownerId: "key-a" });
    expect(meta).not.toHaveProperty("ownerId");
    expect(await getFile(meta.id, { filesRoot: tmp, ownerId: "key-b" })).toBeNull();
    expect(await getFileContent(meta.id, { filesRoot: tmp, ownerId: "key-b" })).toBeNull();
    expect((await listFiles({ filesRoot: tmp, ownerId: "key-b" })).data).toHaveLength(0);
    expect(await deleteFile(meta.id, { filesRoot: tmp, ownerId: "key-b" })).toBeNull();
    expect(await getFile(meta.id, { filesRoot: tmp, allowAllOwners: true })).toMatchObject({ id: meta.id });
  });
});

describe("validateOpenAIJsonl", () => {
  it("accepts well-formed rows and rejects bad ones", () => {
    const good = JSON.stringify({ custom_id: "a", method: "POST", url: "/v1/chat/completions", body: { model: "m" } });
    const { rows, errors } = validateOpenAIJsonl(good + "\n");
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(0);

    const bad = [
      { custom_id: "b", method: "GET", url: "/v1/chat/completions", body: {} },
      { custom_id: "c", method: "POST", url: "/v1/nope", body: {} },
      { method: "POST", url: "/v1/chat/completions", body: {} },
    ].map((r) => JSON.stringify(r)).join("\n");
    const r2 = validateOpenAIJsonl(bad);
    expect(r2.rows).toHaveLength(0);
    expect(r2.errors).toHaveLength(3);
  });
});

describe("OpenAI batches", () => {
  async function makeInput(rows) {
    const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    return uploadFile({ filename: "b.jsonl", bytes: text, purpose: "batch" }, { filesRoot: tmp });
  }

  it("upload → create → poll → one output record per row", async () => {
    const f = await makeInput([
      { custom_id: "r1", method: "POST", url: "/v1/chat/completions", body: { model: "m", messages: [{ role: "user", content: "hi" }] } },
      { custom_id: "r2", method: "POST", url: "/v1/chat/completions", body: { model: "m", messages: [{ role: "user", content: "yo" }] } },
    ]);
    const view = await createOpenAIBatch({ input_file_id: f.id, endpoint: "/v1/chat/completions" }, { filesRoot: tmp, executor: okExecutor });
    expect(view.id).toMatch(/^batch_[0-9a-f]{24}$/);
    expect(view.status).toBe("validating");
    await _waitForBatch(view.id);

    const done = await getBatch(view.id, { filesRoot: tmp, surface: "openai" });
    expect(done.status).toBe("completed");
    expect(done.request_counts).toMatchObject({ total: 2, completed: 2, failed: 0 });
    expect(done.output_file_id).toMatch(/^file_/);

    const out = await getBatchOutputText(view.id, "output", { filesRoot: tmp });
    const records = out.trim().split("\n").map((l) => JSON.parse(l));
    expect(records.map((r) => r.custom_id).sort()).toEqual(["r1", "r2"]);
    for (const r of records) {
      expect(Object.keys(r).sort()).toEqual(["custom_id", "error", "id", "response"]);
      expect(r.response.status_code).toBe(200);
      expect(r.error).toBeNull();
    }
  });

  it("rejects row url != endpoint and non-24h window", async () => {
    const f = await makeInput([
      { custom_id: "r1", method: "POST", url: "/v1/messages", body: { model: "m" } },
    ]);
    await expect(createOpenAIBatch({ input_file_id: f.id, endpoint: "/v1/chat/completions" }, { filesRoot: tmp, executor: okExecutor }))
      .rejects.toThrow(/does not match endpoint/);
    await expect(createOpenAIBatch({ input_file_id: f.id, endpoint: "/v1/messages", completion_window: "1h" }, { filesRoot: tmp, executor: okExecutor }))
      .rejects.toThrow(/completion_window/);
  });

  it("404 on unknown input file", async () => {
    await expect(createOpenAIBatch({ input_file_id: "file_" + "0".repeat(24) }, { filesRoot: tmp, executor: okExecutor }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("isolates input, detail, cancel, and output resources by owner", async () => {
    const text = JSON.stringify({ custom_id: "r1", method: "POST", url: "/v1/chat/completions", body: { model: "m" } }) + "\n";
    const file = await uploadFile({ filename: "owned.jsonl", bytes: text, purpose: "batch" }, { filesRoot: tmp, ownerId: "key-a" });
    await expect(createOpenAIBatch({ input_file_id: file.id }, { filesRoot: tmp, executor: okExecutor, ownerId: "key-b" }))
      .rejects.toMatchObject({ statusCode: 404 });
    const view = await createOpenAIBatch({ input_file_id: file.id }, { filesRoot: tmp, executor: okExecutor, ownerId: "key-a" });
    await _waitForBatch(view.id);
    expect(await getBatch(view.id, { filesRoot: tmp, surface: "openai", ownerId: "key-b" })).toBeNull();
    expect(await cancelBatch(view.id, { filesRoot: tmp, surface: "openai", ownerId: "key-b" })).toBeNull();
    expect(await getBatchOutputText(view.id, "output", { filesRoot: tmp, ownerId: "key-b" })).toBeNull();
    expect(await getBatch(view.id, { filesRoot: tmp, surface: "openai", allowAllOwners: true })).toMatchObject({ id: view.id });
  });

  it("mid-run cancel stops scheduling, finishes active row, finalizes cancelled", async () => {
    // Gate row 2 behind a deferred so cancel is requested while row 1 is active.
    const gate = deferred();
    let started = 0;
    const exec = async ({ custom_id }) => {
      started++;
      if (custom_id === "r2") await gate.promise;
      return { status_code: 200, body: { ok: custom_id } };
    };
    const f = await makeInput([
      { custom_id: "r1", method: "POST", url: "/v1/chat/completions", body: {} },
      { custom_id: "r2", method: "POST", url: "/v1/chat/completions", body: {} },
      { custom_id: "r3", method: "POST", url: "/v1/chat/completions", body: {} },
    ]);
    const view = await createOpenAIBatch({ input_file_id: f.id, endpoint: "/v1/chat/completions" }, { filesRoot: tmp, executor: exec, concurrency: 1 });

    // concurrency 1: row1 runs (resolves immediately), row2 starts and holds the gate;
    // cancel is requested while row2 is active, so row3 is never scheduled.
    while (started < 2) await new Promise((r) => setImmediate(r));
    const cancelling = cancelBatch(view.id, { filesRoot: tmp, surface: "openai" });
    gate.resolve(); // let the active row 2 finish
    const final = await cancelling;

    expect(final.status).toBe("cancelled");
    // r3 must NOT have run: canceled count covers unscheduled rows.
    expect(final.request_counts.canceled).toBeGreaterThanOrEqual(1);
    expect(final.request_counts.completed + final.request_counts.failed + final.request_counts.canceled)
      .toBe(final.request_counts.total);
    const out = await getBatchOutputText(view.id, "output", { filesRoot: tmp });
    const ids = out ? out.trim().split("\n").map((l) => JSON.parse(l).custom_id) : [];
    expect(ids).not.toContain("r3");
  });
});

describe("Anthropic message batches", () => {
  it("create {requests:[{custom_id,params}]} → results JSONL with succeeded", async () => {
    const view = await createAnthropicBatch({
      requests: [
        { custom_id: "a", params: { model: "m", messages: [{ role: "user", content: "hi" }] } },
        { custom_id: "b", params: { model: "m", messages: [{ role: "user", content: "yo" }] } },
      ],
    }, { filesRoot: tmp, executor: okExecutor });
    expect(view.id).toMatch(/^msgbatch_[0-9a-f]{24}$/);
    expect(view.type).toBe("message_batch");
    expect(view.processing_status).toBe("in_progress");
    expect(view.results_url).toBeNull(); // not ended yet
    await _waitForBatch(view.id);

    const done = await getBatch(view.id, { filesRoot: tmp, surface: "anthropic" });
    expect(done.processing_status).toBe("ended");
    expect(done.results_url).toBe(`/v1/messages/batches/${view.id}/results`);
    expect(done.request_counts.succeeded).toBe(2);

    const jsonl = await getAnthropicResultsJsonl(view.id, { filesRoot: tmp });
    const rows = jsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(rows.map((r) => r.custom_id).sort()).toEqual(["a", "b"]);
    for (const r of rows) expect(r.result.type).toBe("succeeded");
  });

  it("non-2xx response row is classified errored in Anthropic results", async () => {
    const exec = async ({ custom_id }) => {
      if (custom_id === "bad") return { status_code: 400, body: { error: { type: "invalid_request_error", message: "nope" } } };
      return { status_code: 200, body: { ok: true } };
    };
    const view = await createAnthropicBatch({
      requests: [
        { custom_id: "good", params: { model: "m" } },
        { custom_id: "bad", params: { model: "m" } },
      ],
    }, { filesRoot: tmp, executor: exec });
    await _waitForBatch(view.id);
    const jsonl = await getAnthropicResultsJsonl(view.id, { filesRoot: tmp });
    const rows = jsonl.trim().split("\n").map((l) => JSON.parse(l));
    const good = rows.find((r) => r.custom_id === "good");
    const bad = rows.find((r) => r.custom_id === "bad");
    expect(good.result.type).toBe("succeeded");
    expect(bad.result.type).toBe("errored");
    expect(bad.result.error.type).toBe("invalid_request_error");
  });

  it("thrown executor row is errored and counted failed", async () => {
    const exec = async ({ custom_id }) => {
      if (custom_id === "boom") throw new Error("upstream down");
      return { status_code: 200, body: {} };
    };
    const view = await createAnthropicBatch({
      requests: [{ custom_id: "ok", params: { model: "m" } }, { custom_id: "boom", params: { model: "m" } }],
    }, { filesRoot: tmp, executor: exec });
    await _waitForBatch(view.id);
    const done = await getBatch(view.id, { filesRoot: tmp, surface: "anthropic" });
    expect(done.request_counts).toMatchObject({ succeeded: 1, errored: 1 });
    const jsonl = await getAnthropicResultsJsonl(view.id, { filesRoot: tmp });
    const boom = jsonl.trim().split("\n").map((l) => JSON.parse(l)).find((r) => r.custom_id === "boom");
    expect(boom.result.type).toBe("errored");
    expect(boom.result.error.message).toContain("upstream down");
  });

  it("Anthropic results preserve input order across mixed success/error outcomes", async () => {
    // Outcomes arrive out of input order (e completes first, a last) and split
    // across the output and error files; results must still follow request order.
    const delays = { a: 40, b: 10, c: 30, d: 0, e: 0 };
    const exec = async ({ custom_id }) => {
      await new Promise((r) => setTimeout(r, delays[custom_id] ?? 0));
      if (custom_id === "b" || custom_id === "d") {
        return { status_code: 400, body: { error: { type: "invalid_request_error", message: "bad " + custom_id } } };
      }
      return { status_code: 200, body: { ok: custom_id } };
    };
    const order = ["a", "b", "c", "d", "e"];
    const view = await createAnthropicBatch({
      requests: order.map((id) => ({ custom_id: id, params: { model: "m" } })),
    }, { filesRoot: tmp, executor: exec, concurrency: 5 });
    await _waitForBatch(view.id);
    const jsonl = await getAnthropicResultsJsonl(view.id, { filesRoot: tmp });
    const rows = jsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(rows.map((r) => r.custom_id)).toEqual(order); // exact input order, no sort
    expect(rows.map((r) => r.result.type)).toEqual(["succeeded", "errored", "succeeded", "errored", "succeeded"]);
  });

  it("getAnthropicResultsJsonl rejects pre-settlement with 409, null only for missing/wrong surface", async () => {
    const gate = deferred();
    const exec = async () => { await gate.promise; return { status_code: 200, body: {} }; };
    const view = await createAnthropicBatch({
      requests: [{ custom_id: "held", params: { model: "m" } }],
    }, { filesRoot: tmp, executor: exec });
    // Still in_progress: results must not be readable yet.
    await expect(getAnthropicResultsJsonl(view.id, { filesRoot: tmp }))
      .rejects.toMatchObject({ statusCode: 409 });
    // Wrong surface (OpenAI id prefix) and unknown id stay null → route maps to 404.
    expect(await getAnthropicResultsJsonl("batch_" + "0".repeat(24), { filesRoot: tmp })).toBeNull();
    expect(await getAnthropicResultsJsonl("msgbatch_" + "0".repeat(24), { filesRoot: tmp })).toBeNull();
    // Release and let the batch settle so afterEach teardown sees a terminal state.
    gate.resolve();
    await _waitForBatch(view.id);
    const jsonl = await getAnthropicResultsJsonl(view.id, { filesRoot: tmp });
    expect(JSON.parse(jsonl.trim()).result.type).toBe("succeeded");
  });

  it("rejects non-array requests", async () => {
    await expect(createAnthropicBatch({ requests: "nope" }, { filesRoot: tmp, executor: okExecutor }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("cross-surface isolation", () => {
  it("OpenAI get/cancel do not see Anthropic batches and vice versa", async () => {
    const a = await createAnthropicBatch({ requests: [{ custom_id: "x", params: { model: "m" } }] }, { filesRoot: tmp, executor: okExecutor });
    await _waitForBatch(a.id);
    expect(await getBatch(a.id, { filesRoot: tmp, surface: "openai" })).toBeNull();
    expect(await cancelBatch(a.id, { filesRoot: tmp, surface: "openai" })).toBeNull();
    const openaiList = await listBatches({ filesRoot: tmp, surface: "openai" });
    expect(openaiList.data).toHaveLength(0);
    const anthList = await listBatches({ filesRoot: tmp, surface: "anthropic" });
    expect(anthList.data).toHaveLength(1);
  });
});
