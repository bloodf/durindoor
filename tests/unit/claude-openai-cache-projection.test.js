import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { addBufferToUsage, filterUsageForFormat } from "../../open-sse/utils/usageTracking.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
}));

const rawUsage = { input_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300, output_tokens: 7 };
const expected = { cached_tokens: 5000, cache_creation_tokens: 300 };

const frames = [
  { type: "message_start", message: { id: "m", model: "claude", role: "assistant", content: [], usage: { ...rawUsage, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "pong" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
  { type: "message_stop" },
];

describe("Claude cache accounting in OpenAI client responses", () => {
  it("keeps cache split through streamed final usage", async () => {
    const sse = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n";
    const upstream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(sse));
      controller.close();
    } });
    const response = await new Response(upstream.pipeThrough(createSSETransformStreamWithLogger(
      FORMATS.CLAUDE, FORMATS.OPENAI, "claude", null, null, "claude"
    ))).text();
    const usage = response.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)).usage).filter(Boolean).at(-1);
    expect(usage.prompt_tokens).toBeGreaterThanOrEqual(5400);
    expect(usage.completion_tokens).toBe(7);
    expect(usage.prompt_tokens_details).toEqual(expected);
  });

  it("keeps cache split in non-streaming translated response", () => {
    const response = translateNonStreamingResponse({
      id: "m", type: "message", model: "claude", role: "assistant",
      content: [{ type: "text", text: "pong" }], stop_reason: "end_turn", usage: rawUsage,
    }, FORMATS.CLAUDE, FORMATS.OPENAI);
    const usage = filterUsageForFormat(addBufferToUsage(response.usage), FORMATS.OPENAI);
    expect(usage.prompt_tokens).toBeGreaterThanOrEqual(5400);
    expect(usage.completion_tokens).toBe(7);
    expect(usage.prompt_tokens_details).toEqual(expected);
  });
});
