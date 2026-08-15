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

    // Intentionally out-of-order: index 2 first (plain click), index 1 second
    // (computer.click), index 0 last (custom apply_patch), then argument deltas.
    const text = await translateOpenAIStream(body, providerBody, [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 2, id: "call_plain", type: "function", function: { name: "click", arguments: "{\"a\":1}" } },
                { index: 1, id: "call_ns", type: "function", function: { name: "computer.click", arguments: "{\"x\":1}" } },
                { index: 0, id: "call_custom", type: "function", function: { name: "apply_patch", arguments: "{\"input\":\"hi\"}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ]);

    const events = parseSseEvents(text);
    const addedItems = events.filter((e) => e.type === "response.output_item.added").map((e) => e.item);
    const doneItems = events.filter((e) => e.type === "response.output_item.done").map((e) => e.item);

    expect(addedItems).toHaveLength(3);
    expect(doneItems).toHaveLength(3);

    const byId = (items) => Object.fromEntries(items.map((i) => [i.call_id, i]));

    const added = byId(addedItems);
    const done = byId(doneItems);

    // Independent output_index per tool; assigned by arrival order, not request order.
    const addedOutputIndexes = addedItems.map((i) => i.output_index);
    expect(new Set(addedOutputIndexes).size).toBe(3);

    // Custom tool: custom_tool_call framing, no namespace.
    expect(added.call_custom.type).toBe("custom_tool_call");
    expect(added.call_custom.name).toBe("apply_patch");
    expect(added.call_custom.namespace).toBeUndefined();
    expect(done.call_custom.type).toBe("custom_tool_call");
    expect(done.call_custom.name).toBe("apply_patch");
    expect(done.call_custom.namespace).toBeUndefined();
    // Custom input was unwrapped from {"input":...} wrapper.
    expect(done.call_custom.input).toBe("hi");

    // Namespaced: function_call with namespace "computer", name "click".
    expect(added.call_ns.type).toBe("function_call");
    expect(added.call_ns.name).toBe("click");
    expect(added.call_ns.namespace).toBe("computer");
    expect(done.call_ns.type).toBe("function_call");
    expect(done.call_ns.name).toBe("click");
    expect(done.call_ns.namespace).toBe("computer");
    expect(done.call_ns.arguments).toBe("{\"x\":1}");

    // Plain click: function_call, NO namespace, no custom framing.
    expect(added.call_plain.type).toBe("function_call");
    expect(added.call_plain.name).toBe("click");
    expect(added.call_plain.namespace).toBeUndefined();
    expect(done.call_plain.type).toBe("function_call");
    expect(done.call_plain.name).toBe("click");
    expect(done.call_plain.namespace).toBeUndefined();
    expect(done.call_plain.arguments).toBe("{\"a\":1}");

    // Output_index is stable per call_id across added → done.
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
