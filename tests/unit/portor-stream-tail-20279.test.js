import { expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { extractUsage, mergeUsage, isProvisionalOutput } from "../../open-sse/utils/usageTracking.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn() }));
const frame = (v) => `data: ${JSON.stringify(v)}\n\n`;
const part = (delta, finish_reason = null) => ({ id: "a", choices: [{ index: 0, delta, finish_reason }] });
const receipt = { id: "a", choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } };
async function run(parts, providerBody) {
  const complete = vi.fn();
  const input = new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
  const transform = createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, "openai", null, null, "test", "connection", { messages: [] }, complete, null, "off", null, providerBody);
  return { output: await new Response(input.pipeThrough(transform)).text(), complete };
}
it("projects a later receipt into the Claude terminal", async () => {
  const { output, complete } = await run([frame(part({ content: "answer" })), frame(part({}, "stop")), frame(receipt)], { stream_options: { include_usage: true } });
  const terminal = [...output.matchAll(/^data: (\{.*\})$/gm)].map((m) => JSON.parse(m[1])).find((e) => e.type === "message_delta");
  expect(terminal.usage.output_tokens).toBe(4);
  expect(complete.mock.calls[0][1]).toMatchObject({ prompt_tokens: 12, completion_tokens: 4 });
});
it("accounts for an unterminated translated receipt", async () => {
  const { complete } = await run([frame(part({ content: "answer" })), `data: ${JSON.stringify(receipt)}`]);
  expect(complete.mock.calls[0][1]).toMatchObject({ input_tokens: 12, output_tokens: 4 });
});
it("keeps valid zero and numeric-string cache evidence", () => {
  expect(extractUsage({ usage: { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: -1 }, prompt_cache_hit_tokens: "0" } }).cached_tokens).toBe(0);
  expect(extractUsage({ usageMetadata: { promptTokenCount: 10, cached_content_token_count: "3" } }).cached_tokens).toBe(3);
});

it("retains an output-only provider receipt", () => {
  expect(extractUsage({ usage: { completion_tokens: 7 } })).toMatchObject({ completion_tokens: 7 });
});

it("records content in an unterminated translated tail", async () => {
  const { complete } = await run([`data: ${JSON.stringify(part({ content: "tail text" }))}`]);
  expect(complete.mock.calls[0][0].content).toBe("tail text");
});

it("keeps provider usage in an interrupted stream snapshot", async () => {
  const transform = createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, "openai", null, null, "test", "connection", { messages: [] }, vi.fn());
  const input = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frame({ ...part({ content: "answer" }), usage: { prompt_tokens: 12, completion_tokens: 7 } }))); } });
  const reader = input.pipeThrough(transform).getReader();
  await reader.read();
  expect(transform.getStreamSnapshot().usage).toMatchObject({ input_tokens: 12, output_tokens: 7 });
  void reader.cancel();
});

it("uses valid Gemini cache evidence when the primary alias is invalid", () => {
  expect(extractUsage({ usageMetadata: { promptTokenCount: 10, cachedContentTokenCount: -1, cached_content_token_count: "0" } }).cached_tokens).toBe(0);
});

const claudeStart = (output_tokens) => ({ type: "message_start", message: { id: "m", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens } } });
const claudeText = (text) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });

it("replaces a positive Claude message_start output with the lower final receipt", () => {
  const start = extractUsage(claudeStart(5));
  const final = extractUsage({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } });
  expect(mergeUsage(start, final)).toMatchObject({ prompt_tokens: 10, completion_tokens: 3 });
  expect(isProvisionalOutput(mergeUsage(start, final))).toBe(false);
  const withoutOutput = mergeUsage(start, extractUsage({ type: "message_delta", usage: {} }));
  expect(isProvisionalOutput(withoutOutput)).toBe(false);
  expect(withoutOutput.completion_tokens).toBe(5);
});

it("refreshes provisional Claude output from content in an interrupted passthrough snapshot", async () => {
  const transform = createPassthroughStreamWithLogger("anthropic", null, null, "test", "connection", { messages: [] }, vi.fn(), null, FORMATS.CLAUDE);
  const input = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`event: message_start\n${frame(claudeStart(1))}event: content_block_delta\n${frame(claudeText("x".repeat(80)))}`));
  } });
  const reader = input.pipeThrough(transform).getReader();
  await reader.read();
  expect(transform.getStreamSnapshot().usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 20 });
  void reader.cancel();
});
