import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";
import { createTerminalTracker } from "../../open-sse/utils/streamTerminal.js";

const toolStart = { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "write", input: {} } };
const toolDelta = (text) => ({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: text } });
const claudeFrames = (events) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
const chatChunk = (delta) => ({ id: "chatcmpl-1", model: "m", choices: [{ index: 0, delta }] });

async function run(frames) {
  const complete = vi.fn();
  const error = vi.fn();
  let connected = true;
  const lifecycle = {
    isConnected: () => connected,
    handleComplete: complete,
    handleError: (err) => { connected = false; error(err); },
    handleDisconnect: vi.fn(),
  };
  const transform = createSSEStream({ mode: "translate", targetFormat: FORMATS.CLAUDE, sourceFormat: FORMATS.OPENAI, onStreamComplete: complete });
  const output = createDisconnectAwareStream(transform, lifecycle, null, createTerminalTracker(FORMATS.OPENAI));
  const writer = transform.writable.getWriter();
  // One write per frame, as upstream reads arrive; the reader drains concurrently.
  const written = (async () => {
    for (const frame of frames) {
      await writer.write(new TextEncoder().encode(frame));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await writer.close();
  })().catch(() => {});
  const text = await new Response(output).text();
  await written;
  return { text, error, complete };
}

describe("per-stream retained-size budget (OmniRoute #21176, b4d9e75b)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails a stream whose tool arguments grow past the cap across small frames", async () => {
    vi.stubEnv("STREAM_MAX_RETAINED_BYTES", "100");
    const { text, error, complete } = await run(claudeFrames([toolStart, ...Array.from({ length: 5 }, () => toolDelta("a".repeat(30)))]));
    expect(text).toContain('"error"');
    expect(text.match(/\[DONE\]/g)).toHaveLength(1);
    expect(text.match(/a{30}/g)).toHaveLength(3);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0].code).toBe("invalid_sse_payload");
    expect(complete).not.toHaveBeenCalled();
  });

  it("leaves a stream under the cap unchanged", async () => {
    vi.stubEnv("STREAM_MAX_RETAINED_BYTES", "100");
    const { text, error } = await run(claudeFrames([toolStart, toolDelta("a".repeat(30)), toolDelta("a".repeat(30))]));
    expect(text.match(/a{30}/g)).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    [FORMATS.OPENAI_RESPONSES, { reasoning_content: "r".repeat(60) }],
    [FORMATS.OPENAI_RESPONSES, { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "r".repeat(60) } }] }],
    [FORMATS.CLAUDE, { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "r".repeat(60) } }] }],
    [FORMATS.ANTIGRAVITY, { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "r".repeat(60) } }] }],
  ])("charges the %s translator buffers", (format, delta) => {
    vi.stubEnv("STREAM_MAX_RETAINED_BYTES", "100");
    const state = initState(format);
    translateResponse(FORMATS.OPENAI, format, chatChunk(delta), state);
    expect(() => translateResponse(FORMATS.OPENAI, format, chatChunk(delta), state)).toThrow(/retained size limit/);
  });

  it("treats 0 as no cap", () => {
    vi.stubEnv("STREAM_MAX_RETAINED_BYTES", "0");
    const state = initState(FORMATS.ANTIGRAVITY);
    const chunk = chatChunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "r".repeat(500) } }] });
    expect(() => translateResponse(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, chunk, state)).not.toThrow();
  });
});
