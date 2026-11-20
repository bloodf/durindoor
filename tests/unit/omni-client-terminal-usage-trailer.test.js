import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn() }));
const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
const chunk = (id, delta, finish_reason = null) => ({ id, choices: [{ index: 0, delta, finish_reason }] });
const usage = (id) => ({ id, choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } });

async function run(format, parts) {
  const complete = vi.fn();
  const input = new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } });
  const transform = createSSETransformStreamWithLogger(FORMATS.OPENAI, format, "openai", null, null, "test", "connection", { messages: [] }, complete);
  const output = await new Response(input.pipeThrough(transform)).text();
  return { output, complete };
}

describe("buffered client terminal usage", () => {
  it.each([FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES])("projects an adjacent matching receipt into one %s terminal", async (format) => {
    const { output, complete } = await run(format, [frame(chunk("a", { content: "answer" })) + frame(chunk("a", {}, "stop")) + frame(usage("a")) + "data: [DONE]\n\n"]);
    const events = [...output.matchAll(/^data: (\{.*\})$/gm)].map((match) => JSON.parse(match[1]));
    const terminal = events.filter((event) => event.type === (format === FORMATS.CLAUDE ? "message_delta" : "response.completed"));
    expect(terminal).toHaveLength(1);
    expect(format === FORMATS.CLAUDE ? terminal[0].usage.output_tokens : terminal[0].response.usage.output_tokens).toBe(4);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toMatchObject({ prompt_tokens: 12, completion_tokens: 4 });
  });

  it("does not project a neighbouring response's receipt", async () => {
    const { output } = await run(FORMATS.CLAUDE, [frame(chunk("a", { content: "answer" })) + frame(chunk("a", {}, "stop")) + frame(usage("b")) + "data: [DONE]\n\n"]);
    const terminal = [...output.matchAll(/^data: (\{.*\})$/gm)].map((m) => JSON.parse(m[1])).find((e) => e.type === "message_delta");
    expect(terminal.usage.output_tokens).not.toBe(4);
  });
});
