// decolua/9router#4665: an estimate must never be persisted over real provider usage.
// Estimate-vs-real precedence already exists here; the residual was a real report
// without an input count (zeroed prompt_tokens) wiping the estimated input.
import { describe, expect, it, vi } from "vitest";
import { mergeUsage } from "../../open-sse/utils/usageTracking.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");

const estimate = { prompt_tokens: 500_000, completion_tokens: 2_003, total_tokens: 502_003, estimated: true };

describe("decolua/9router#4665 estimate vs real usage", () => {
  it("keeps the estimated input when the real report is output-only", () => {
    expect(mergeUsage(estimate, { prompt_tokens: 0, completion_tokens: 40, total_tokens: 40 })).toEqual({
      prompt_tokens: 500_000, completion_tokens: 40, total_tokens: 500_040, estimated: true,
    });
  });

  it("keeps the estimate when the real report is all zeroes, without dropping zero markers", () => {
    const zeroed = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, reasoning_included_in_output: 0 };
    expect(mergeUsage(estimate, zeroed)).toEqual({ ...estimate, reasoning_included_in_output: 0 });
  });

  it("takes a zero uncached input when the cache counts report the input", () => {
    const merged = mergeUsage(estimate, { prompt_tokens: 0, completion_tokens: 40, cache_read_input_tokens: 900 });
    expect(merged).toMatchObject({ prompt_tokens: 0, cache_read_input_tokens: 900, total_tokens: 40 });
  });

  it("records the trailer's real usage for an image request whose estimate is far larger", async () => {
    const body = {
      model: "gpt-test",
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(2_000_000)}` } }] }],
    };
    const real = { prompt_tokens: 1_105, completion_tokens: 12, total_tokens: 1_117 };
    const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
    const upstream = sse({ id: "c1", choices: [{ index: 0, delta: { content: "A red square." } }] }) +
      sse({ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
      sse({ id: "c1", choices: [], usage: real }) +
      "data: [DONE]\n\n";

    let recorded = null;
    const transform = createPassthroughStreamWithLogger("openai", null, null, "gpt-test", "c1", body, (_content, usage) => { recorded = usage; });
    await new Response(new Blob([upstream]).stream().pipeThrough(transform)).text();

    expect(recorded).toMatchObject(real);
    expect(recorded.estimated).toBeFalsy();
  });
});
