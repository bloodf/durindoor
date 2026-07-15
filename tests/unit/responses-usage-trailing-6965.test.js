import { describe, expect, it } from "vitest";

import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import {
  openaiResponsesToOpenAIResponse,
  openaiToOpenAIResponsesResponse,
} from "../../open-sse/translator/response/openai-responses.js";

const chunks = [
  {
    id: "chatcmpl-trailing-usage",
    model: "gpt-4.1",
    choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
  },
  {
    id: "chatcmpl-trailing-usage",
    model: "gpt-4.1",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: null,
  },
  {
    id: "chatcmpl-trailing-usage",
    model: "gpt-4.1",
    choices: [],
    usage: { prompt_tokens: 55, completion_tokens: 11, total_tokens: 66 },
  },
];

describe("Responses trailing usage", () => {
  it("routes through the registered translator with deferred completion intact", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = chunks.flatMap((chunk) =>
      translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state),
    );
    const completed = events.filter(({ event }) => event === "response.completed");

    expect(completed).toHaveLength(1);
    expect(completed[0].data.response.usage.total_tokens).toBe(66);
  });

  it("defers translator completion until trailing usage arrives", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    const completed = events.filter(({ event }) => event === "response.completed");

    expect(completed).toHaveLength(1);
    expect(completed[0].data.response.usage).toEqual({
      input_tokens: 55,
      output_tokens: 11,
      total_tokens: 66,
    });
  });

  it("defers transformer completion until trailing usage arrives", async () => {
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

    for (const chunk of chunks) {
      await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
    }
    await writer.close();
    await reading;

    const completed = output
      .filter((event) => event.startsWith("event: response.completed"))
      .map((event) => JSON.parse(event.match(/data: (.*)\n/)[1]));
    expect(completed).toHaveLength(1);
    expect(completed[0].response.usage).toEqual({
      input_tokens: 55,
      output_tokens: 11,
      total_tokens: 66,
    });
  });

  it("transformer completes once when finish_reason and usage share one chunk", async () => {
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

    const sameChunk = [
      chunks[0],
      {
        id: "chatcmpl-trailing-usage",
        model: "gpt-4.1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      },
      // bare empty-choices chunk after completion must not re-trigger it
      { id: "chatcmpl-trailing-usage", model: "gpt-4.1", choices: [] },
    ];
    for (const chunk of sameChunk) {
      await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
    }
    await writer.close();
    await reading;

    const completed = output.filter((event) => event.startsWith("event: response.completed"));
    expect(completed).toHaveLength(1);
    expect(JSON.parse(completed[0].match(/data: (.*)\n/)[1]).response.usage).toEqual({
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 12,
    });
  });

  it("completes immediately when finish_reason and usage share one chunk", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [
      chunks[0],
      {
        id: "chatcmpl-trailing-usage",
        model: "gpt-4.1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      },
    ].flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    const completed = events.filter(({ event }) => event === "response.completed");

    expect(completed).toHaveLength(1);
    expect(completed[0].data.response.usage).toEqual({
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 12,
    });
    expect(state.awaitingTrailingUsage).toBe(false);
  });

  it("ignores empty-choices chunks that carry no usage", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [
      ...chunks.slice(0, 2),
      { id: "chatcmpl-trailing-usage", model: "gpt-4.1", choices: [] },
    ].flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));

    expect(events.some(({ event }) => event === "response.completed")).toBe(false);
    expect(state.awaitingTrailingUsage).toBe(true);

    const tail = [chunks[2]].flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    const completed = tail.filter(({ event }) => event === "response.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].data.response.usage.total_tokens).toBe(66);
  });

  it("completes on flush when no trailing usage arrives", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = chunks.slice(0, 2).flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));

    expect(events.some(({ event }) => event === "response.completed")).toBe(false);
    expect(openaiToOpenAIResponsesResponse(null, state).some(({ event }) => event === "response.completed")).toBe(true);

    // flush fallback must not duplicate an already-sent completion
    const stateDone = initState(FORMATS.OPENAI_RESPONSES);
    const all = chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, stateDone));
    const flushed = openaiToOpenAIResponsesResponse(null, stateDone);
    const completedCount = [...all, ...flushed].filter(({ event }) => event === "response.completed").length;
    expect(completedCount).toBe(1);
  });

  it("preserves tool calls through deferred completion finalized at flush", () => {
    // Chat→Responses: a streamed function call must survive the deferred completion
    // path (finish_reason without usage, finalized by stream-end flush).
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const toolChunks = [
      {
        id: "chatcmpl-tool",
        model: "gpt-5.3-codex",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "apply_patch", arguments: '{"input":"PATCH' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-tool",
        model: "gpt-5.3-codex",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '_BODY"}' } }] }, finish_reason: null }],
      },
      // finish without usage defers completion; no trailing usage chunk ever comes
      { id: "chatcmpl-tool", model: "gpt-5.3-codex", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      null,
    ];
    const events = toolChunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));

    const done = events.find(({ event }) => event === "response.output_item.done");
    expect(done.data.item.name).toBe("apply_patch");
    expect(done.data.item.arguments).toBe('{"input":"PATCH_BODY"}');
    expect(events.filter(({ event }) => event === "response.completed")).toHaveLength(1);
  });

  it("preserves custom tools in Responses→OpenAI translation", () => {
    // custom_tool_call events must translate with name, arguments and a tool_calls
    // finish_reason intact alongside the new completion path.
    const reverseState = {};
    const reverseChunks = [
      { type: "response.output_item.added", data: { item: { type: "custom_tool_call", call_id: "call_1", name: "apply_patch" } } },
      { type: "response.custom_tool_call_input.delta", data: { delta: "*** Begin Patch" } },
      { type: "response.output_item.done", data: { item: { type: "custom_tool_call", call_id: "call_1", name: "apply_patch" } } },
      { type: "response.completed", data: { response: { usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } } } },
    ];
    const out = reverseChunks
      .map((chunk) => openaiResponsesToOpenAIResponse(chunk, reverseState))
      .filter(Boolean);

    const toolStart = out.find((chunk) => chunk.choices?.[0]?.delta?.tool_calls);
    expect(toolStart.choices[0].delta.tool_calls[0].function.name).toBe("apply_patch");
    expect(toolStart.choices[0].delta.tool_calls[0].id).toBe("call_1");
    const argDelta = out.find((chunk) => chunk.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments);
    expect(argDelta.choices[0].delta.tool_calls[0].function.arguments).toBe("*** Begin Patch");
    const finish = out.find((chunk) => chunk.choices?.[0]?.finish_reason);
    expect(finish.choices[0].finish_reason).toBe("tool_calls");
  });
});
