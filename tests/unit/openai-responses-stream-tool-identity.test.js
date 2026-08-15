import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

function encodeChunks(...chunks) {
  return chunks
    .map((c) => `data: ${JSON.stringify(c)}`)
    .concat(["", "data: [DONE]", ""])
    .join("\n");
}

async function translateOpenAIStream(body, providerBody, payloads) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(encodeChunks(...payloads)));
      controller.close();
    },
  });

  const output = stream.pipeThrough(createSSETransformStreamWithLogger(
    FORMATS.OPENAI,
    FORMATS.OPENAI_RESPONSES,
    "test",
    null,
    null,
    "test-model",
    null,
    body,
    null,
    null,
    "off",
    null,
    providerBody,
  ));
  const reader = output.getReader();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseSseEvents(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .filter((payload) => payload && payload !== "[DONE]")
    .map((payload) => JSON.parse(payload));
}

describe("Responses stream tool identity", () => {
  it("keeps custom and namespace tool declarations from the client request", async () => {
    const body = {
      tools: [
        { type: "custom", name: "apply_patch" },
        {
          type: "namespace",
          name: "computer",
          tools: [{ name: "click" }],
        },
      ],
    };
    const providerBody = {
      tools: [
        { type: "function", function: { name: "apply_patch" } },
        { type: "function", function: { name: "computer.click" } },
      ],
    };

    const text = await translateOpenAIStream(body, providerBody, [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_custom", type: "function", function: { name: "apply_patch", arguments: "{}" } },
                { index: 1, id: "call_ns", type: "function", function: { name: "computer.click", arguments: "{}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ]);
    const events = parseSseEvents(text);
    const added = events.filter((e) => e.type === "response.output_item.added").map((e) => e.item);

    const custom = added.find((i) => i.name === "apply_patch");
    expect(custom).toBeDefined();
    expect(custom.type).toBe("custom_tool_call");
    expect(custom.namespace).toBeUndefined();

    const namespaced = added.find((i) => i.name === "click");
    expect(namespaced).toBeDefined();
    expect(namespaced.type).toBe("function_call");
    expect(namespaced.namespace).toBe("computer");
  });

  it("preserves parallel indexes and out-of-order deltas across custom, namespaced, and plain function tools", async () => {
    const body = {
      tools: [
        { type: "custom", name: "apply_patch" },
        {
          type: "namespace",
          name: "computer",
          tools: [{ name: "click" }],
        },
        { type: "function", function: { name: "click" } },
      ],
    };
    const providerBody = {
      tools: [
        { type: "function", function: { name: "apply_patch" } },
        { type: "function", function: { name: "computer.click" } },
        { type: "function", function: { name: "click" } },
      ],
    };

    // Metadata and arguments arrive in different SSE payloads. Index 2 comes
    // first, then index 1, then index 0; IDs, names, and argument fragments
    // are deliberately interleaved to detect state loss or cross-index reuse.
    const text = await translateOpenAIStream(body, providerBody, [
      {
        choices: [{
          index: 0,
          delta: {
            tool_calls: [
              { index: 2, id: "call_plain", type: "function", function: { arguments: "{\"a\":" } },
              { index: 1, type: "function", function: { name: "computer.click", arguments: "{\"x\":" } },
            ],
          },
        }],
      },
      {
        choices: [{
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: "call_custom", type: "function", function: { name: "apply_patch", arguments: "{\"input\":" } },
              { index: 2, type: "function", function: { name: "click" } },
              { index: 1, id: "call_ns", type: "function", function: {} },
            ],
          },
        }],
      },
      {
        choices: [{
          index: 0,
          delta: {
            tool_calls: [
              { index: 1, type: "function", function: { arguments: "1}" } },
              { index: 0, type: "function", function: { arguments: "\"hi\"}" } },
              { index: 2, type: "function", function: { arguments: "1}" } },
            ],
          },
          finish_reason: "tool_calls",
        }],
      },
    ]);

    const events = parseSseEvents(text);
    const addedItems = events
      .filter((e) => e.type === "response.output_item.added")
      .map(({ output_index, item }) => ({ output_index, item }));
    const doneItems = events
      .filter((e) => e.type === "response.output_item.done")
      .map(({ output_index, item }) => ({ output_index, item }));

    expect(addedItems).toHaveLength(3);
    expect(doneItems).toHaveLength(3);

    const byId = (items) => Object.fromEntries(items.map((entry) => [entry.item.call_id, entry]));
    const added = byId(addedItems);
    const done = byId(doneItems);

    // Independent output_index per tool; assigned by arrival order, not request order.
    expect(new Set(addedItems.map((entry) => entry.output_index)).size).toBe(3);

    // Custom tool: custom_tool_call framing, no namespace.
    expect(added.call_custom.item.type).toBe("custom_tool_call");
    expect(added.call_custom.item.name).toBe("apply_patch");
    expect(added.call_custom.item.namespace).toBeUndefined();
    expect(done.call_custom.item.type).toBe("custom_tool_call");
    expect(done.call_custom.item.name).toBe("apply_patch");
    expect(done.call_custom.item.namespace).toBeUndefined();
    expect(done.call_custom.item.input).toBe("hi");

    // Namespaced: function_call with namespace "computer", name "click".
    expect(added.call_ns.item.type).toBe("function_call");
    expect(added.call_ns.item.name).toBe("click");
    expect(added.call_ns.item.namespace).toBe("computer");
    expect(done.call_ns.item.type).toBe("function_call");
    expect(done.call_ns.item.name).toBe("click");
    expect(done.call_ns.item.namespace).toBe("computer");
    expect(done.call_ns.item.arguments).toBe("{\"x\":1}");

    // Plain click: function_call, NO namespace, no custom framing.
    expect(added.call_plain.item.type).toBe("function_call");
    expect(added.call_plain.item.name).toBe("click");
    expect(added.call_plain.item.namespace).toBeUndefined();
    expect(done.call_plain.item.type).toBe("function_call");
    expect(done.call_plain.item.name).toBe("click");
    expect(done.call_plain.item.namespace).toBeUndefined();
    expect(done.call_plain.item.arguments).toBe("{\"a\":1}");

    // output_index is stable for each call_id through added → done.
    for (const id of ["call_custom", "call_ns", "call_plain"]) {
      expect(added[id].output_index).toBe(done[id].output_index);
    }
  });

  it("falls back to provider tools when no client body exists", async () => {
    const providerBody = {
      tools: [{ type: "custom", name: "apply_patch" }],
    };

    const text = await translateOpenAIStream(null, providerBody, [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_custom", type: "function", function: { name: "apply_patch", arguments: "{}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ]);

    const events = parseSseEvents(text);
    const added = events.filter((e) => e.type === "response.output_item.added").map((e) => e.item);
    expect(added).toHaveLength(1);
    expect(added[0].type).toBe("custom_tool_call");
    expect(added[0].name).toBe("apply_patch");
  });

  it("does not classify non-Responses translation through the Responses identity path", () => {
    const stream = createSSETransformStreamWithLogger(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "test",
      null,
      null,
      "test-model",
      null,
      {
        tools: [
          { type: "custom", name: "apply_patch" },
          {
            type: "namespace",
            name: "computer",
            tools: [{ name: "click" }],
          },
        ],
      },
      null,
      null,
      "off",
      null,
      {
        tools: [
          { type: "function", function: { name: "apply_patch" } },
          { type: "function", function: { name: "computer.click" } },
        ],
      },
    );

    expect(stream).toBeInstanceOf(TransformStream);
  });
});
