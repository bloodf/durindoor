import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const events = [
  { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5", content: [], usage: { input_tokens: 900, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 663, buyer_cost_micro: 17155 } },
];
const STOP = { type: "message_stop" };
const frame = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}`;

async function relay(input) {
  const completed = vi.fn();
  const transform = createPassthroughStreamWithLogger("anthropic-compatible", null, null, "claude-sonnet-5", "conn-1",
    { messages: [{ role: "user", content: "hi" }] }, completed, null, FORMATS.CLAUDE);
  const encoder = new TextEncoder();
  // Split inside the field name so the omission cannot depend on chunk boundaries.
  const splitAt = input.indexOf("buyer_cost_micro") + "buyer_cost".length;
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input.slice(0, splitAt)));
      controller.enqueue(encoder.encode(input.slice(splitAt)));
      controller.close();
    },
  });
  const wire = await new Response(source.pipeThrough(transform)).text();
  const terminal = wire.split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)))
    .find((event) => event.type === "message_delta");
  return { wire, terminal, completed };
}

describe("OmniRoute #21136 - native Claude stream omits the provider's buyer cost", () => {
  it("drops buyer_cost_micro from message_delta and keeps the token counts", async () => {
    const { wire, terminal, completed } = await relay([...events, STOP].map(frame).join("\n\n") + "\n\n");
    expect(wire).not.toContain("buyer_cost_micro");
    expect(terminal.usage).toEqual({ output_tokens: 663 });
    expect(terminal.delta).toEqual({ stop_reason: "end_turn" });
    expect(wire).toContain('"type":"message_stop"');
    expect(completed.mock.calls[0][1]).toMatchObject({ prompt_tokens: 900, completion_tokens: 663 });
  });

  it.each([["no newline", ""], ["a single newline", "\n"]])(
    "drops it from an unterminated final frame ending with %s", async (_label, tail) => {
      // message_stop arrives first so the truncated-stream guard stays satisfied
      // while message_delta is the buffered, unterminated line.
      const ordered = [...events.slice(0, -1), STOP, events.at(-1)];
      const { wire, terminal } = await relay(ordered.map(frame).join("\n\n") + tail);
      expect(wire).not.toContain("buyer_cost_micro");
      expect(terminal.usage).toEqual({ output_tokens: 663 });
    });

  it("leaves a message_delta without the field byte-identical", async () => {
    const plain = { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } };
    const line = `data:${JSON.stringify(plain)}`;
    const transform = createPassthroughStreamWithLogger("anthropic-compatible", null, null, "claude-sonnet-5", "conn-1", { messages: [] }, null, null, FORMATS.CLAUDE);
    const input = `${line}\n\n${frame(STOP)}\n\n`;
    const wire = await new Response(new Response(input).body.pipeThrough(transform)).text();
    expect(wire).toContain(JSON.stringify(plain));
  });
});
