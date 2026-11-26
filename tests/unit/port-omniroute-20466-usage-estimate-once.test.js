import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { estimateUsage } = await import("../../open-sse/utils/usageTracking.js");

const messages = [{ role: "user", content: "word ".repeat(2000) }];
const chunk = (index, content, finish = null) => `data: ${JSON.stringify({
  id: "chatcmpl-abcdef123456", object: "chat.completion.chunk", created: 1, model: "gpt-x",
  choices: [{ index, delta: content ? { content } : {}, finish_reason: finish }],
})}\n\n`;

/** A request body that counts how often it is serialized. */
function countingBody() {
  const plain = { model: "gpt-x", messages };
  const counter = { count: 0 };
  const body = Object.defineProperty({ ...plain }, "toJSON", {
    value: () => { counter.count += 1; return plain; },
  });
  return { body, plain, counter };
}

describe("OmniRoute #20466 estimates the request body once per stream", () => {
  it("serializes the body once across repeated finish chunks and keeps the same usage", async () => {
    const { body, plain, counter } = countingBody();
    const sseText = [
      ...Array.from({ length: 50 }, (_, i) => chunk(i % 3, "hello ")),
      chunk(0, "", "stop"), chunk(1, "", "stop"), chunk(2, "", "stop"),
      "data: [DONE]\n\n",
    ].join("");
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger("openai", null, null, "gpt-x", null, body, onComplete, null, "openai");
    const out = await new Response(new Blob([sseText]).stream().pipeThrough(transform)).text();

    const expected = estimateUsage(plain, 300, "openai");
    const usages = out.split("\n").filter((line) => line.includes('"usage"')).map((line) => JSON.parse(line.slice(6)).usage);
    expect(usages).toHaveLength(3);
    for (const usage of usages) {
      expect(usage).toMatchObject({ prompt_tokens: expected.prompt_tokens, completion_tokens: expected.completion_tokens, estimated: true });
    }
    // The recorded copy is the same estimate without the client context buffer (9router #3913).
    const recorded = estimateUsage(plain, 300, "openai", { buffer: false });
    expect(onComplete.mock.calls[0][1]).toMatchObject({ prompt_tokens: recorded.prompt_tokens, completion_tokens: recorded.completion_tokens });
    expect(counter.count).toBe(1);
  });
});
