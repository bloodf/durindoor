import { expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { extractUsage } from "../../open-sse/utils/usageTracking.js";
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
