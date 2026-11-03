// Port of upstream 9router 95c9d03e (#4992): a streamed OpenAI tool-call
// fragment that opens a new index without an `id` aborts strict
// OpenAI-compatible clients (@ai-sdk/openai-compatible: "Expected 'id' to be a
// string."). Passthrough fills the id on the opening fragment only.
import { describe, expect, it } from "vitest";
import { ensureStreamToolCallIds } from "../../open-sse/utils/streamHelpers.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const chunk = (toolCalls, choiceIndex = 0) => ({
  id: "chatcmpl-abc12345",
  object: "chat.completion.chunk",
  created: 1700000000,
  model: "m",
  choices: [{ index: choiceIndex, delta: { tool_calls: toolCalls }, finish_reason: null }],
});

async function runPassthrough(chunks) {
  const stream = createPassthroughStreamWithLogger("openai", null, null, "gpt-4.1", "conn-1", {}, null, "sk-test", FORMATS.OPENAI);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const decoder = new TextDecoder();
  const readAll = (async () => {
    let output = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return output;
      output += decoder.decode(value);
    }
  })();
  await writer.write(new TextEncoder().encode(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")));
  await writer.close();
  const output = await readAll;
  return output.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
}

const calls = (events) => events.flatMap((event) => event.choices || []).flatMap((choice) => choice.delta?.tool_calls || []);

describe("ensureStreamToolCallIds", () => {
  it("mints a string id for a fragment that opens a new index without one", () => {
    const seen = new Set();
    const c = chunk([{ index: 3, function: { name: "read", arguments: "{}" } }]);
    expect(ensureStreamToolCallIds(c, seen)).toBe(true);
    expect(c.choices[0].delta.tool_calls[0].id).toMatch(/^call_0_3_/);
  });

  it("keeps a provider id and leaves continuation fragments without an id", () => {
    const seen = new Set();
    expect(ensureStreamToolCallIds(chunk([{ index: 0, id: "call_up", function: { name: "read" } }]), seen)).toBe(false);
    const later = chunk([{ index: 0, function: { arguments: "{\"f\":1}" } }]);
    expect(ensureStreamToolCallIds(later, seen)).toBe(false);
    expect(later.choices[0].delta.tool_calls[0]).not.toHaveProperty("id");
  });

  it("tracks indices per choice and per call", () => {
    const seen = new Set();
    const c = chunk([{ index: 0, function: { name: "a" } }, { index: 1, function: { name: "b" } }]);
    ensureStreamToolCallIds(c, seen);
    const [a, b] = c.choices[0].delta.tool_calls;
    expect(isNonEmptyString(a.id) && isNonEmptyString(b.id)).toBe(true);
    const other = chunk([{ index: 0, function: { name: "c" } }], 1);
    expect(ensureStreamToolCallIds(other, seen)).toBe(true);
  });

  it("ignores chunks without tool calls", () => {
    expect(ensureStreamToolCallIds({ choices: [{ delta: { content: "hi" } }] }, new Set())).toBe(false);
    expect(ensureStreamToolCallIds({ type: "message_start" }, new Set())).toBe(false);
  });
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

describe("OpenAI passthrough stream", () => {
  it("fills the id of a late fragment that opens a new tool-call index", async () => {
    const events = await runPassthrough([
      chunk([{ index: 0, id: "call_first", type: "function", function: { name: "read", arguments: "" } }]),
      chunk([{ index: 0, function: { arguments: "{}" } }]),
      chunk([{ index: 1, type: "function", function: { name: "write", arguments: "{}" } }]),
    ]);
    const all = calls(events);
    expect(all[0].id).toBe("call_first");
    expect(all[1]).not.toHaveProperty("id");
    expect(all[2].index).toBe(1);
    expect(isNonEmptyString(all[2].id)).toBe(true);
  });
});
