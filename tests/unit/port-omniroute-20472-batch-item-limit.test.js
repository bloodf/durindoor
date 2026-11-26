import { afterEach, describe, expect, it, vi } from "vitest";
import { validateOpenAIJsonl } from "../../open-sse/services/localFilesBatches.js";

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

  it.each(["", "0", "-5", "abc"])("falls back to 100000 for MAX_BATCH_ITEMS=%j", (value) => {
    vi.stubEnv("MAX_BATCH_ITEMS", value);

    const result = validateOpenAIJsonl("x\n".repeat(100001));

    expect(result.errors).toEqual([{ error: "batch has 100001 items; MAX_BATCH_ITEMS limits a batch to 100000" }]);
  });
});
