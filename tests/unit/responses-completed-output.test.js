import { describe, expect, it } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
const finish = { id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage };

function toolChunk(index, id = "call_lookup", name = "lookup") {
  return {
    id: "chatcmpl-1",
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index, id, type: "function", function: { name, arguments: "{}" } }] },
      finish_reason: null,
    }],
  };
}

async function transform(chunks) {
  const stream = createResponsesApiTransformStream();
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const output = [];
  const reading = (async () => {
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      output.push(decoder.decode(value));
    }
  })();
  for (const chunk of chunks) await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
  await writer.close();
  await reading;
  return output
    .filter((event) => !event.includes("data: [DONE]"))
    .map((event) => JSON.parse(event.match(/data: (.*)\n/)[1]));
}

async function transformBeforeFlush(chunk) {
  const events = [];
  const stream = createResponsesApiTransformStream({
    logInput() {},
    logOutput(output) {
      if (output.startsWith("event:")) events.push(JSON.parse(output.match(/data: (.*)$/m)[1]));
    },
    flush() {},
  });
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const reading = (async () => {
    while (!(await reader.read()).done) {}
  })();
  await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
  const beforeFlush = [...events];
  await writer.close();
  await reading;
  return beforeFlush;
}

function translate(chunks, state = initState(FORMATS.OPENAI_RESPONSES)) {
  return chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
}

function completedOutput(events, key = "type") {
  const completed = events.find((event) => event[key] === "response.completed");
  return key === "type" ? completed.response.output : completed.data.response.output;
}

describe("Responses terminal output", () => {
  it("returns empty output when no output item completed", async () => {
    expect(completedOutput(await transform([]))).toEqual([]);
    expect(completedOutput(translate([null]), "event")).toEqual([]);
  });

  it("returns mixed reasoning, message, and completed function output in wire order", async () => {
    const chunks = [
      { id: "chatcmpl-1", choices: [{ index: 0, delta: { reasoning_content: "think" }, finish_reason: null }] },
      { id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }] },
      toolChunk(0),
      finish,
    ];

    for (const [events, key] of [[await transform(chunks), "type"], [translate(chunks), "event"]]) {
      const output = completedOutput(events, key);
      expect(output.map(({ type }) => type)).toEqual(["reasoning", "message", "function_call"]);
      expect(output[0].summary[0].text).toBe("think");
      expect(output[1].content[0].text).toBe("answer");
      expect(output[2]).toEqual(expect.objectContaining({ name: "lookup", arguments: "{}", status: "completed" }));
    }
  });

  it("marks text items in progress when added and completed when finalized", async () => {
    const chunks = [
      { id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }] },
      { id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
    ];

    for (const [events, key] of [[await transform(chunks), "type"], [translate(chunks), "event"]]) {
      const added = events.find((event) => event[key] === "response.output_item.added");
      const done = events.find((event) => event[key] === "response.output_item.done");
      expect(key === "type" ? added.item.status : added.data.item.status).toBe("in_progress");
      expect(key === "type" ? done.item.status : done.data.item.status).toBe("completed");
      expect(completedOutput(events, key)[0].status).toBe("completed");
    }
  });

  it.each([-1, "0", 0.5, null, false])(
    "rejects invalid transformer tool_call.index %j before output lifecycle emission",
    async (index) => {
      const events = await transform([toolChunk(index), finish]);
      expect(events.filter(({ type }) => type.includes("output_item") || type.includes("function_call"))).toEqual([]);
      expect(completedOutput(events)).toEqual([]);
    },
  );

  it("keeps repeated transformer tool indices on one dense output item", async () => {
    const events = await transform([
      { id: "chatcmpl-1", choices: [{ index: 0, delta: { tool_calls: [{ index: 7, id: "call_x", type: "function", function: { name: "lookup", arguments: '{"q":' } }] }, finish_reason: null }] },
      {
        id: "chatcmpl-1",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 7, function: { arguments: '\"x\"}' } }] }, finish_reason: null }],
      },
      finish,
    ]);
    const added = events.filter(({ type }) => type === "response.output_item.added");
    const done = events.filter(({ type }) => type === "response.output_item.done");

    expect(added).toHaveLength(1);
    expect(done).toHaveLength(1);
    expect([added[0].output_index, done[0].output_index]).toEqual([0, 0]);
    expect(completedOutput(events)).toEqual([
      expect.objectContaining({ call_id: "call_x", name: "lookup", arguments: '{"q":"x"}', status: "completed" }),
    ]);
  });

  it.each([-1, "0", 0.5, null, false])(
    "rejects invalid transformer choice.index %j before any event emission",
    async (index) => {
      const chunk = { id: "invalid", model: "invalid", choices: [{ index, delta: { content: "invalid" }, finish_reason: "stop" }], usage };
      expect(await transformBeforeFlush(chunk)).toEqual([]);
    },
  );

  it.each([-1, "0", 0.5, null, false])(
    "rejects invalid translator choice.index %j before any event or state mutation",
    (index) => {
      const state = initState(FORMATS.OPENAI_RESPONSES);
      const before = structuredClone(state);
      const chunk = { id: "invalid", model: "invalid", choices: [{ index, delta: { content: "invalid" }, finish_reason: "stop" }], usage };

      expect(openaiToOpenAIResponsesResponse(chunk, state)).toEqual([]);
      expect(state).toEqual(before);
    },
  );

  it.each([-1, "0", 0.5, null, false])(
    "rejects later invalid translator choice.index %j without closing or mutating open output",
    (index) => {
      const state = initState(FORMATS.OPENAI_RESPONSES);
      translate([{ choices: [{ index: 0, delta: { content: "before" }, finish_reason: null }] }], state);
      const before = structuredClone(state);

      expect(openaiToOpenAIResponsesResponse(
        { choices: [{ index, delta: {}, finish_reason: "stop" }], usage },
        state,
      )).toEqual([]);
      expect(state).toEqual(before);

      const events = translate([
        { choices: [{ index: 0, delta: { content: "after" }, finish_reason: "stop" }], usage },
      ], state);
      expect(completedOutput(events, "event")[0].content[0].text).toBe("beforeafter");
    },
  );

  it.each([-1, "0", 0.5, null, false])(
    "rejects invalid translator tool_call.index %j before any event or state mutation",
    (index) => {
      const state = initState(FORMATS.OPENAI_RESPONSES);
      translate([{ choices: [{ index: 0, delta: { content: "before" }, finish_reason: null }] }], state);
      const before = structuredClone(state);

      expect(openaiToOpenAIResponsesResponse(toolChunk(index), state)).toEqual([]);
      expect(state).toEqual(before);

      const events = translate([
        { choices: [{ index: 0, delta: { content: "after" }, finish_reason: "stop" }], usage },
      ], state);
      expect(completedOutput(events, "event")[0].content[0].text).toBe("beforeafter");
    },
  );

  it("does not finalize an open message from an invalid choice index", async () => {
    const events = await transform([
      { choices: [{ index: 0, delta: { content: "before" }, finish_reason: null }] },
      { choices: [{ index: -1, delta: {}, finish_reason: "stop" }] },
      { choices: [{ index: 0, delta: { content: "after" }, finish_reason: "stop" }], usage },
    ]);

    expect(completedOutput(events)[0].content[0].text).toBe("beforeafter");
  });

  it("does not finalize an open message from an invalid tool_call index", async () => {
    const events = await transform([
      { choices: [{ index: 0, delta: { content: "before" }, finish_reason: null }] },
      toolChunk(-1),
      { choices: [{ index: 0, delta: { content: "after" }, finish_reason: "stop" }], usage },
    ]);

    expect(completedOutput(events)[0].content[0].text).toBe("beforeafter");
  });

  it("defensively keeps first items at unique dense integer indices", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.completedOutputItems = [
      { outputIndex: 1, sequence: 2, item: { name: "one" } },
      { outputIndex: -1, sequence: 1, item: { name: "negative" } },
      { outputIndex: 0, sequence: 3, item: { name: "zero" } },
      { outputIndex: 0, sequence: 4, item: { name: "duplicate" } },
      { outputIndex: "2", sequence: 5, item: { name: "string" } },
      { outputIndex: 3, sequence: 6, item: { name: "after-gap" } },
    ];

    expect(completedOutput(translate([null], state), "event").map(({ name }) => name)).toEqual(["zero", "one"]);
  });
});
