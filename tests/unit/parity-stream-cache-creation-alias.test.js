import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { canonicalizeUsage, extractUsage, normalizeUsage, hasValidUsage } from "../../open-sse/utils/usageTracking.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const text = { choices: [{ delta: { content: "Hello" } }] };
const finish = { choices: [{ delta: {}, finish_reason: "stop" }] };
const sse = (chunk) => `data: ${JSON.stringify(chunk)}\n\n`;
const done = "data: [DONE]\n\n";
const placeholder = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
const body = { messages: [{ role: "user", content: "Hello" }] };
const encoder = new TextEncoder();

function makeStream(onStreamComplete) {
  return createSSEStream({
    targetFormat: FORMATS.OPENAI,
    sourceFormat: FORMATS.CLAUDE,
    body,
    onStreamComplete,
  });
}

function events(output) {
  return [...output.matchAll(/^data: (\{.*\})$/gm)].map((match) => JSON.parse(match[1]));
}

async function run(frames, onStreamComplete) {
  const input = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return events(await new Response(input.pipeThrough(makeStream(onStreamComplete))).text());
}

const base = { prompt_tokens: 100, completion_tokens: 5, cached_tokens: 20 };
const expected = { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 };

async function check(usage, inline, clientUsage, write) {
  const complete = vi.fn();
  const result = await run([sse(text), sse(inline ? { ...finish, usage } : finish),
    ...(!inline ? [sse({ choices: [], usage })] : []), done], complete);
  expect(result.filter(({ type }) => type === "message_delta")).toHaveLength(1);
  expect(result.filter(({ type }) => type === "message_stop")).toHaveLength(1);
  expect(result.at(-2).usage).toEqual(clientUsage);
  expect(complete).toHaveBeenCalledTimes(1);
  for (const normalized of [extractUsage({ usage }), normalizeUsage(usage), complete.mock.calls[0][1]]) {
    expect(canonicalizeUsage(normalized)).toMatchObject({ prompt_tokens: 100, completion_tokens: 5,
      cached_tokens: 20, cache_creation_input_tokens: write });
  }
}

describe("cache creation alias through shared extraction and gateway", () => {
  it("extracts the top-level alias independently of gateway translation", () => {
    expect(canonicalizeUsage(extractUsage({ usage: { ...base, cache_creation_tokens: 30 } })))
      .toMatchObject({ prompt_tokens: 100, cache_creation_input_tokens: 30 });
  });
  it("preserves typed receipt validation for numeric strings", () => {
    expect(hasValidUsage({ prompt_tokens: "100", completion_tokens: "5" })).toBe(false);
  });
  it.each([false, true])("accepts top-level alias, inline=%s", async (inline) => {
    await check({ ...base, cache_creation_tokens: 30 }, inline, expected, 30);
  });
  it.each(["prompt_tokens_details", "input_tokens_details"])("retains nested alias in %s", async (field) => {
    await check({ ...base, [field]: { cached_tokens: 20, cache_creation_tokens: 30 } }, false, expected, 30);
  });
  it("keeps canonical explicit zero over the alias", async () => {
    await check({ ...base, cache_creation_input_tokens: 0, cache_creation_tokens: 30 }, false,
      { input_tokens: 80, output_tokens: 5, cache_read_input_tokens: 20 }, 0);
  });
  it.each([-1, Infinity, -Infinity, NaN, "30", "bad", {}, true])("rejects malformed alias %s", async (alias) => {
    // JSON serializes nonfinite numbers as null; extraction also sees the original value.
    await check({ ...base, cache_creation_tokens: alias }, false,
      { input_tokens: 80, output_tokens: 5, cache_read_input_tokens: 20 }, 0);
  });
  it("retains ordinary usage without aliases", async () => {
    await check(base, false, { input_tokens: 80, output_tokens: 5, cache_read_input_tokens: 20 }, 0);
  });
});
