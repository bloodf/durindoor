import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");

const chunk = (delta, finishReason = null) =>
  `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;

async function run(frames) {
  const completions = [];
  const transform = createPassthroughStreamWithLogger("openai", null, null, "gpt-test", null, {}, (content) => completions.push(content), null, "openai");
  const upstream = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  });
  const output = await new Response(upstream.pipeThrough(transform)).text();
  return { output, completions };
}

const count = (text, needle) => text.split(needle).length - 1;

describe("OmniRoute #19703 - a passthrough chat stream cut before finish_reason", () => {
  it.each([
    ["text", [chunk({ content: "partial" })]],
    ["a tool call", [chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "f", arguments: "{" } }] })]],
    ["an unterminated last line", [chunk({ content: "partial" }).trimEnd()]],
  ])("sends one error and records a failure after %s", async (_name, frames) => {
    const { output, completions } = await run(frames);

    expect(count(output, '"error"')).toBe(1);
    expect(count(output, "data: [DONE]")).toBe(1);
    expect(output).toMatch(/\n\ndata: \{"error"/);
    expect(completions).toHaveLength(1);
    expect(completions[0].upstreamError).toMatchObject({ code: "incomplete_upstream_stream" });
  });

  it.each([
    ["a finish reason without [DONE]", [chunk({ content: "done" }), chunk({}, "stop")]],
    ["a finish reason in the unterminated last line", [chunk({ content: "done" }), chunk({}, "stop").trimEnd()]],
    ["a bare [DONE]", [chunk({ content: "done" }), "data: [DONE]\n\n"]],
    ["no output", [chunk({ role: "assistant" })]],
  ])("keeps the current ending after %s", async (_name, frames) => {
    const { output, completions } = await run(frames);

    expect(output).not.toContain('"error"');
    expect(count(output, "data: [DONE]")).toBe(1);
    expect(completions[0].upstreamError).toBeUndefined();
  });
});
