import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { createSseFrameReader } from "../../open-sse/utils/sseFrames.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const sse = (chunk) => `data: ${JSON.stringify(chunk)}\n\n`;

describe("Claude usage trailers across empty data heartbeats", () => {
  it.each(["data:\n\n", "data: \n\n", "data:   \t\n\n"])("waits for measured usage across %j", async (heartbeat) => {
    const encoder = new TextEncoder();
    const onStreamComplete = vi.fn();
    const input = new ReadableStream({
      start(controller) {
        for (const frame of [
          sse({ choices: [{ delta: { content: "Hello" } }] }),
          sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
          heartbeat,
          sse({
            choices: [],
            usage: {
              prompt_tokens: 8505,
              completion_tokens: 16,
              prompt_tokens_details: { cached_tokens: 8448 },
            },
          }),
          "data: [DONE]\n\n",
        ]) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    });
    const output = await new Response(input.pipeThrough(createSSEStream({
      targetFormat: FORMATS.OPENAI,
      sourceFormat: FORMATS.CLAUDE,
      body: { messages: [{ role: "user", content: "Hello" }] },
      onStreamComplete,
    }))).text();
    const reader = createSseFrameReader();
    const events = [...reader.push(output), ...reader.flush()]
      .filter((frame) => frame.data.trim())
      .map((frame) => JSON.parse(frame.data));
    const terminal = events.filter(({ type }) => type === "message_delta");
    expect(terminal).toHaveLength(1);
    expect(terminal[0].usage).toEqual({ input_tokens: 57, output_tokens: 16, cache_read_input_tokens: 8448 });
    expect(events.filter(({ type }) => type === "message_stop")).toHaveLength(1);
    expect(events.at(-1).type).toBe("message_stop");
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
  });
});
