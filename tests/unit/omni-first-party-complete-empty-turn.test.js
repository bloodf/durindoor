import { describe, expect, it } from "vitest";
import { peekStreamForContent } from "../../open-sse/utils/streamContentPeek.js";

const frame = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const start = { type: "message_start", message: { type: "message", role: "assistant", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } };
const stop = { type: "message_stop" };
const delta = (reason) => ({ type: "message_delta", delta: { stop_reason: reason, stop_sequence: reason === "stop_sequence" ? "END" : null }, usage: { output_tokens: 0 } });
const response = (events) => new Response(events.map(frame).join(""), { headers: { "content-type": "text/event-stream", "x-omniroute-selected-connection-id": "claimed-connection" } });

// A wire header and Claude-shaped events do not establish the served host or connection.
describe("unverified native-looking Claude frames at the combo peek", () => {
  it.each(["end_turn", "stop_sequence"])("keeps a complete empty %s lifecycle empty", async (reason) => {
    const input = [start, delta(reason), stop];
    const result = await peekStreamForContent(response(input));
    expect(result.hasContent).toBe(false);
    expect(result.outcome).toBe("empty");
    expect(await new Response(result.body).text()).toBe(input.map(frame).join(""));
  });

  it.each([
    { type: "content_block_delta", delta: { type: "text_delta", text: "answer" } },
    { type: "content_block_start", content_block: { type: "tool_use", id: "tool1", name: "lookup", input: {} } },
  ])("continues to recognize and replay output %#", async (output) => {
    const input = [start, output, delta("end_turn"), stop];
    const result = await peekStreamForContent(response(input));
    expect(result.hasContent).toBe(true);
    expect(await new Response(result.body).text()).toBe(input.map(frame).join(""));
  });
});
