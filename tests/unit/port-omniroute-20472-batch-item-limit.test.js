import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateOpenAIJsonl, uploadFile, createOpenAIBatch } from "../../open-sse/services/localFilesBatches.js";

const row = (id) => JSON.stringify({ custom_id: id, method: "POST", url: "/v1/chat/completions", body: { model: "m", messages: [] } });
const file = (count) => Array.from({ length: count }, (_, i) => row(`r${i}`)).join("\n\n  \n") + "\n";

describe("OmniRoute #20472 (5e682c65cdf9) - reject oversized batch files before parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("refuses a file above MAX_BATCH_ITEMS without parsing any line", () => {
    vi.stubEnv("MAX_BATCH_ITEMS", "3");
    const text = file(4);
    const parse = vi.spyOn(JSON, "parse");

    const result = validateOpenAIJsonl(text);

    expect(parse).not.toHaveBeenCalled();
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ error: "batch has 4 items; MAX_BATCH_ITEMS limits a batch to 3" }]);
  });

  it("accepts a file at the limit and does not count blank lines", () => {
    vi.stubEnv("MAX_BATCH_ITEMS", "3");

    const result = validateOpenAIJsonl(file(3));

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);
  });

  it("enforces byte limits before parsing and preserves CRLF row numbers", () => {
    vi.stubEnv("MAX_BATCH_LINE_BYTES", "5");
    const parse = vi.spyOn(JSON, "parse");
    expect(validateOpenAIJsonl("\r\n123456\r\n").errors).toEqual([{ line: 2, error: "line exceeds MAX_BATCH_LINE_BYTES limit of 5 bytes" }]);
    expect(parse).not.toHaveBeenCalled();
    vi.stubEnv("MAX_BATCH_BYTES", "3");
    expect(validateOpenAIJsonl("éé").errors[0].error).toContain("MAX_BATCH_BYTES");
  });

  it("counts Unicode line separators as text, not JSONL delimiters", () => {
    vi.stubEnv("MAX_BATCH_ITEMS", "1");
    const text = row("a\u2028b\u2029c");
    expect(validateOpenAIJsonl(text).rows[0].custom_id).toBe("a\u2028b\u2029c");
    expect(validateOpenAIJsonl(`${text}\r\ninvalid`).errors[0].error).toContain("2 items");
  });

  it("checks stored bytes after authorization, regardless of metadata", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-test-"));
    try {
      const meta = await uploadFile({ filename: "input.jsonl", bytes: row("a"), purpose: "batch" }, { filesRoot: root, ownerId: "owner" });
      vi.stubEnv("MAX_BATCH_BYTES", "8");
      await expect(createOpenAIBatch({ input_file_id: meta.id }, { filesRoot: root, ownerId: "other" })).rejects.toMatchObject({ statusCode: 404 });
      await expect(createOpenAIBatch({ input_file_id: meta.id }, { filesRoot: root, ownerId: "owner" })).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("MAX_BATCH_BYTES") });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["", "0", "-5", "abc"])("falls back to 100000 for MAX_BATCH_ITEMS=%j", (value) => {
    vi.stubEnv("MAX_BATCH_ITEMS", value);

    const result = validateOpenAIJsonl("x\n".repeat(100001));

    expect(result.errors).toEqual([{ error: "batch has 100001 items; MAX_BATCH_ITEMS limits a batch to 100000" }]);
  });
});
