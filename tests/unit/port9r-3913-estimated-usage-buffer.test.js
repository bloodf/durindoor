import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { DEFAULT_BUFFER_TOKENS, estimateInputTokens, estimateNonStreamingUsage } = await import("../../open-sse/utils/usageTracking.js");

const body = { model: "gpt-x", messages: [{ role: "user", content: "hi" }] };
const frame = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: "chatcmpl-abcdef123456", object: "chat.completion.chunk", created: 1, model: "gpt-x", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const upstream = frame({ role: "assistant", content: "Hello there" }) + frame({}, "stop") + "data: [DONE]\n\n";

async function run(transform) {
  return new Response(new Blob([upstream]).stream().pipeThrough(transform)).text();
}

const events = (text) => text.split("\n")
  .filter((line) => line.startsWith("data: {"))
  .map((line) => JSON.parse(line.slice(6)));

describe("9router #3913 (c8db1f558922) - the client context buffer stays out of the recorded turn", () => {
  const original = process.env.USAGE_BUFFER_TOKENS;
  beforeEach(() => { delete process.env.USAGE_BUFFER_TOKENS; });
  afterEach(() => { if (original !== undefined) process.env.USAGE_BUFFER_TOKENS = original; });

  it("records a passthrough estimate unbuffered and sends the client one buffer", async () => {
    let recorded = null;
    const out = await run(createPassthroughStreamWithLogger("openai", null, null, "gpt-x", "c1", body, (_content, usage) => { recorded = usage; }));
    const client = events(out).filter((event) => event.usage).at(-1).usage;

    expect(recorded.estimated).toBe(true);
    expect(recorded.prompt_tokens).toBe(estimateInputTokens(body));
    expect(client.prompt_tokens).toBe(estimateInputTokens(body) + DEFAULT_BUFFER_TOKENS);
  });

  it("records the unbuffered estimate for a translated Claude client stream", async () => {
    let recorded = null;
    await run(createSSETransformStreamWithLogger("openai", "claude", "openai", null, null, "gpt-x", "c1", body, (_content, usage) => { recorded = usage; }));

    expect(recorded.estimated).toBe(true);
    expect(recorded.input_tokens).toBe(estimateInputTokens(body));
  });

  it("records the unbuffered estimate for a non-streaming reply", () => {
    const usage = estimateNonStreamingUsage(body, { choices: [{ message: { content: "Hello there" } }] });

    expect(usage.prompt_tokens).toBe(estimateInputTokens(body));
    expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
  });
});
