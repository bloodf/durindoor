import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { toClaudeInputSchema } from "../../open-sse/translator/concerns/claudeInputSchema.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

const chatChunk = (delta, finishReason = null) => ({
  id: "chatcmpl_integrity",
  object: "chat.completion.chunk",
  created: 1,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});

async function translateStream(upstreamFormat, clientFormat, payloads) {
  const input = payloads.map((payload) => `${payload.type ? `event: ${payload.type}\n` : ""}data: ${JSON.stringify(payload)}\n\n`).join("");
  const transform = createSSETransformStreamWithLogger(upstreamFormat, clientFormat, "test-provider", null, null, "m");
  const wire = await new Response(new Response(input).body.pipeThrough(transform)).text();
  return wire.split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
}

const toResponses = (chunks) => translateStream(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunks);
const itemEvents = (events) => events
  .filter((event) => event.type === "response.output_item.added" || event.type === "response.output_item.done")
  .map((event) => [event.type.split(".").pop(), event.output_index, event.item.type]);

describe("9router #4472 - Claude tool schemas with a root union", () => {
  const union = {
    oneOf: [
      { type: "object", properties: { mode: { const: "create" }, name: { type: "string" } }, required: ["mode", "name"], additionalProperties: false },
      { type: "object", properties: { mode: { const: "update" }, id: { type: "string" } }, required: ["mode", "id"], additionalProperties: false },
    ],
  };

  it("merges oneOf variants into one object root without touching the caller's schema", () => {
    const original = structuredClone(union);

    expect(toClaudeInputSchema(union, undefined, "update")).toEqual({
      type: "object",
      properties: {
        mode: { anyOf: [{ const: "create" }, { const: "update" }] },
        name: { type: "string" },
        id: { type: "string" },
      },
      required: ["mode"],
      additionalProperties: false,
      description: 'Argument combinations (oneOf, match exactly one): [1] requires mode, name where mode={"const":"create"}; [2] requires mode, id where mode={"const":"update"};',
    });
    expect(union).toEqual(original);
  });

  it("unites allOf requirements on a Claude passthrough tool, including a custom wrapper", () => {
    const schema = {
      type: "object",
      properties: { base: { type: "boolean" } },
      required: ["base"],
      allOf: [
        { type: "object", properties: { left: { type: "string" } }, required: ["left"] },
        { type: "object", properties: { right: { type: "number" } }, required: ["right"] },
      ],
    };
    const body = { model: "claude-sonnet-4-5", messages: [], tools: [{ name: "plain", input_schema: schema }, { type: "custom", name: "wrapped", custom: { input_schema: schema } }] };
    prepareClaudeRequest(body, "claude");

    for (const sent of [body.tools[0].input_schema, body.tools[1].custom.input_schema]) {
      expect(sent).toEqual({
        type: "object",
        properties: { base: { type: "boolean" }, left: { type: "string" }, right: { type: "number" } },
        required: ["base", "left", "right"],
      });
    }
    expect(schema).toHaveProperty("allOf");
  });

  it("resolves local refs in variants, bounds cycles and keeps nested unions", () => {
    const sent = toClaudeInputSchema({
      anyOf: [{ $ref: "#/$defs/a" }, { $ref: "#/$defs/loop" }],
      $defs: {
        a: { type: "object", properties: { value: { anyOf: [{ type: "string" }, { type: "number" }] }, ["__proto__x"]: { type: "string" } } },
        loop: { anyOf: [{ $ref: "#/$defs/loop" }] },
      },
    }, undefined, "refs");

    expect(sent.type).toBe("object");
    expect(sent).not.toHaveProperty("anyOf");
    expect(sent.properties.value).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
    expect(sent.$defs).toBeDefined();
  });

  it("leaves a plain object schema as the same reference", () => {
    const body = { model: "claude-sonnet-4-5", messages: [], tools: [{ name: "t", input_schema: { type: "object", properties: { a: { type: "string" } } } }] };
    const schema = body.tools[0].input_schema;
    prepareClaudeRequest(body, "claude");

    expect(body.tools[0].input_schema).toBe(schema);
  });
});

describe("9router #4472 - streamed refusals", () => {
  it("emits a Responses refusal part for Chat refusal deltas", async () => {
    const events = await toResponses([
      chatChunk({ refusal: "I cannot " }),
      chatChunk({ refusal: "help with that." }),
      chatChunk({}, "stop"),
    ]);

    expect(events.filter((event) => event.type === "response.refusal.delta").map((event) => event.delta).join(""))
      .toBe("I cannot help with that.");
    expect(events.find((event) => event.type === "response.refusal.done").refusal).toBe("I cannot help with that.");
    const terminal = events.find((event) => event.type === "response.completed");
    expect(terminal.response.output).toEqual([
      expect.objectContaining({ type: "message", content: [{ type: "refusal", refusal: "I cannot help with that." }] }),
    ]);
  });

  it("keeps text and a later refusal in separate message items", async () => {
    const events = await toResponses([
      chatChunk({ content: "Partly. " }),
      chatChunk({ refusal: "Not the rest." }),
      chatChunk({}, "stop"),
    ]);

    const done = events.filter((event) => event.type === "response.output_item.done").map((event) => event.item);
    expect(done.map((item) => item.content[0].type)).toEqual(["output_text", "refusal"]);
    expect(new Set(done.map((item) => item.id)).size).toBe(2);
  });

  it("forwards a Responses refusal to a Chat client", async () => {
    const events = await translateStream(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, [
      { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
      { type: "response.refusal.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "No." },
      { type: "response.completed", response: { id: "resp_1", status: "completed" } },
    ]);

    expect(events.map((event) => event.choices?.[0]?.delta?.refusal || "").join("")).toBe("No.");
  });
});

describe("9router #4472 - reasoning that resumes after answer text", () => {
  it("opens new items instead of writing into closed ones", async () => {
    const events = await toResponses([
      chatChunk({ reasoning_content: "first thought" }),
      chatChunk({ content: "draft" }),
      chatChunk({ reasoning_content: "second thought" }),
      chatChunk({ content: "final answer" }),
      chatChunk({}, "stop"),
    ]);

    expect(itemEvents(events)).toEqual([
      ["added", 0, "reasoning"], ["done", 0, "reasoning"],
      ["added", 1, "message"], ["done", 1, "message"],
      ["added", 2, "reasoning"], ["done", 2, "reasoning"],
      ["added", 3, "message"], ["done", 3, "message"],
    ]);
    const output = events.find((event) => event.type === "response.completed").response.output;
    expect(output.map((item) => item.summary?.[0]?.text ?? item.content[0].text))
      .toEqual(["first thought", "draft", "second thought", "final answer"]);
    expect(new Set(output.map((item) => item.id)).size).toBe(4);
  });

  it("does not open a new item for whitespace reasoning after the answer started", async () => {
    const events = await toResponses([
      chatChunk({ reasoning_content: "thought" }),
      chatChunk({ content: "answer " }),
      chatChunk({ reasoning_content: "\n" }),
      chatChunk({ content: "continues" }),
      chatChunk({}, "stop"),
    ]);

    expect(itemEvents(events).filter(([kind]) => kind === "added").map(([, , type]) => type)).toEqual(["reasoning", "message"]);
  });
});
