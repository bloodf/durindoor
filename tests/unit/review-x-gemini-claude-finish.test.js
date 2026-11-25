import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}), trackPendingRequest: vi.fn(),
}));

async function run(frames) {
  const onStreamComplete = vi.fn();
  const input = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
  const output = await new Response(new Response(input).body.pipeThrough(createSSEStream({
    targetFormat: FORMATS.GEMINI, sourceFormat: FORMATS.CLAUDE, provider: "gemini",
    model: "gemini-fixture", body: { messages: [] }, onStreamComplete,
  }))).text();
  return { output, onStreamComplete };
}

describe("Gemini to Claude stream completion", () => {
  it("finalizes a finished candidate successfully", async () => {
    const { output, onStreamComplete } = await run([
      { candidates: [{ content: { parts: [{ text: "hello" }] } }] },
      { candidates: [{ finishReason: "STOP" }] },
    ]);
    expect(output).toContain("message_stop");
    expect(output).not.toContain("incomplete_upstream_stream");
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][0].upstreamError).toBeUndefined();
  });

  it("recognizes a candidate-less prompt block as terminal", async () => {
    const { output, onStreamComplete } = await run([{ promptFeedback: { blockReason: "SAFETY" } }]);
    expect(output).not.toContain("incomplete_upstream_stream");
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][0].upstreamError).toBeUndefined();
  });

  it("reports a stream cut before its finish reason", async () => {
    const { output, onStreamComplete } = await run([{ candidates: [{ content: { parts: [{ text: "partial" }] } }] }]);
    expect(output).toContain("event: error");
    expect(output).toContain("incomplete_upstream_stream");
    expect(onStreamComplete.mock.calls[0][0].upstreamError).toMatchObject({ code: "incomplete_upstream_stream" });
  });
});
