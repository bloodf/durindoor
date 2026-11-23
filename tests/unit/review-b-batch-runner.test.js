import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadFile, createOpenAIBatch, createAnthropicBatch, getBatch, listBatches, getAnthropicResultsJsonl, _batchRows, _resetBatches, _waitForBatch } from "../../open-sse/services/localFilesBatches.js";

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-review-")); _resetBatches(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); _resetBatches(); fs.rmSync(root, { recursive: true, force: true }); });
const requests = (ids) => ids.map((custom_id) => ({ custom_id, params: { secret: "large body" } }));
const executor = async () => ({ body: { ok: true } });

describe("batch runner regressions", () => {
  it("rejects duplicate IDs on both surfaces with 400", async () => {
    await expect(createAnthropicBatch({ requests: requests(["a", "a"]) }, { filesRoot: root, executor })).rejects.toMatchObject({ statusCode: 400 });
    const rows = ["a", "a"].map((custom_id) => JSON.stringify({ custom_id, method: "POST", url: "/v1/chat/completions", body: {} })).join("\n");
    const file = await uploadFile({ filename: "input.jsonl", bytes: rows }, { filesRoot: root });
    await expect(createOpenAIBatch({ input_file_id: file.id }, { filesRoot: root, executor })).rejects.toMatchObject({ statusCode: 400 });
  });
  it("waits for an active promise without scheduling immediate polling", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const immediate = vi.spyOn(globalThis, "setImmediate");
    const started = [];
    const batch = await createAnthropicBatch({ requests: requests(["a", "b"]) }, { filesRoot: root, concurrency: 1, executor: async ({ custom_id }) => { started.push(custom_id); await gate; return {}; } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toEqual(["a"]);
    expect(immediate).not.toHaveBeenCalled();
    release();
    await _waitForBatch(batch.id);
    expect(started).toEqual(["a", "b"]);
  });
  it("releases request bodies at finalization while preserving ordered results", async () => {
    const batch = await createAnthropicBatch({ requests: requests(["a", "b"]) }, { filesRoot: root, executor });
    await _waitForBatch(batch.id);
    expect(_batchRows(batch.id)).toEqual([{ custom_id: "a" }, { custom_id: "b" }]);
    expect((await getAnthropicResultsJsonl(batch.id, { filesRoot: root })).trim().split("\n").map((line) => JSON.parse(line).custom_id)).toEqual(["a", "b"]);
  });
  it("prunes expired batches on access", async () => {
    vi.useFakeTimers();
    const batch = await createAnthropicBatch({ requests: requests(["a"]) }, { filesRoot: root, executor });
    await _waitForBatch(batch.id);
    vi.setSystemTime(Date.now() + 24 * 3600 * 1000);
    expect(await getBatch(batch.id)).toBeNull();
    expect((await listBatches()).data).toEqual([]);
  });
});
