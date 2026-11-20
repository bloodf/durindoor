import { describe, expect, it, vi } from "vitest";
import { createEmptyTerminalGuard } from "../../open-sse/utils/emptyStreamTerminal.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const encoder = new TextEncoder();
async function run(frames, { format = FORMATS.OPENAI, verdict = true, snapshot = {} } = {}) {
  const source = new ReadableStream({ start(controller) { for (const frame of frames) controller.enqueue(encoder.encode(frame)); controller.close(); } });
  return new Response(source.pipeThrough(createEmptyTerminalGuard(format, () => verdict, () => snapshot))).text();
}
const stop = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
const done = 'data: [DONE]\n\n';

describe("empty terminal ordering", () => {
  it("replaces fragmented empty success with an error before DONE", async () => {
    const result = await run([stop.slice(0, 15), stop.slice(15), done]);
    expect(result).toContain('"error"');
    expect(result.indexOf('"error"')).toBeLessThan(result.indexOf('[DONE]'));
    expect(result).not.toContain('"finish_reason":"stop"');
  });
  it.each([{ content: "hello" }, { thinking: "thinking" }, { hadToolCalls: true }, { usage: { completion_tokens: 1 } }])("preserves useful completion %#", async (snapshot) => {
    expect(await run([stop, done], { verdict: false, snapshot })).toBe(stop + done);
  });
  it("preserves an upstream error", async () => {
    const error = 'data: {"error":{"message":"failed"}}\n\n';
    expect(await run([error, done], { verdict: false })).toBe(error + done);
  });
  it.each([
    [FORMATS.CLAUDE, 'event: message_stop\ndata: {"type":"message_stop"}\n\n', 'event: error'],
    [FORMATS.OPENAI_RESPONSES, 'event: response.completed\ndata: {"type":"response.completed"}\n\n', 'event: response.failed'],
  ])("emits a format appropriate error for %s", async (format, terminal, expected) => {
    const result = await run([terminal], { format });
    expect(result).toContain(expected);
    expect(result).not.toContain(terminal);
  });
  it.each([
    [FORMATS.CLAUDE, 'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","name":"lookup"}}\n\n', 'event: message_stop\ndata: {"type":"message_stop"}\n\n'],
    [FORMATS.OPENAI_RESPONSES, 'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"function_call"}}\n\n', 'event: response.completed\ndata: {"type":"response.completed"}\n\n'],
  ])("preserves native tool-only output for %s", async (format, output, terminal) => {
    expect(await run([output, terminal], { format })).toBe(output + terminal);
  });
  it("cancels promptly while a terminal is held", async () => {
    const cancel = vi.fn();
    const source = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(stop)); }, cancel });
    const reader = source.pipeThrough(createEmptyTerminalGuard(FORMATS.OPENAI, () => null, () => ({}))).getReader();
    const pending = reader.read();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await reader.cancel();
    await pending;
    expect(cancel).toHaveBeenCalledOnce();
  });
});

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn() }));

it("uses actual transform completion and preserves trailing usage", async () => {
  const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");
  const complete = vi.fn();
  let verdict = null;
  const transform = createPassthroughStreamWithLogger("openai", null, null, "fixture", null, {}, (content, usage) => {
    complete(content, usage);
    verdict = !content.content && !content.thinking && !content.hadToolCalls && !usage?.completion_tokens;
  }, null, FORMATS.OPENAI);
  const usage = 'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n';
  const source = new ReadableStream({ start(controller) { for (const frame of [stop, usage, done]) controller.enqueue(encoder.encode(frame)); controller.close(); } });
  const result = await new Response(source.pipeThrough(transform).pipeThrough(createEmptyTerminalGuard(FORMATS.OPENAI, () => verdict, () => transform.getEmptyStreamSnapshot()))).text();
  expect(result).not.toContain('"error"');
  expect(result).toContain('"completion_tokens":3');
  expect(complete).toHaveBeenCalledOnce();
  expect(complete.mock.calls[0][1].completion_tokens).toBe(3);
});

it("reports an empty actual transform once without forwarding success", async () => {
  const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");
  const complete = vi.fn();
  let verdict = null;
  const transform = createPassthroughStreamWithLogger("openai", null, null, "fixture", null, {}, (content, usage) => {
    complete(content, usage);
    verdict = !content.content && !content.thinking && !content.hadToolCalls && !usage?.completion_tokens;
  }, null, FORMATS.OPENAI);
  const source = new ReadableStream({ start(controller) { for (const frame of [stop, done]) controller.enqueue(encoder.encode(frame)); controller.close(); } });
  const result = await new Response(source.pipeThrough(transform).pipeThrough(createEmptyTerminalGuard(FORMATS.OPENAI, () => verdict, () => transform.getEmptyStreamSnapshot()))).text();
  expect(result).toContain('"error"');
  expect(result).not.toContain('"finish_reason":"stop"');
  expect(complete).toHaveBeenCalledOnce();
});

it("preserves a non-stop terminal and its DONE sentinel", async () => {
  const terminal = 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n';
  expect(await run([terminal, done])).toBe(terminal + done);
});
