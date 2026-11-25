import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));

import { toClaudeInputSchema } from "../../open-sse/translator/concerns/claudeInputSchema.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

const sse = (events) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
async function translateStream(events, sourceFormat) {
  return new Response(new Response(sse(events)).body.pipeThrough(createSSEStream({
    targetFormat: "openai-responses", sourceFormat, provider: "openai", model: "m", body: { messages: [] },
  }))).text();
}

describe("upstream #4490 - a Responses stream with no terminal event", () => {
  const delta = { type: "response.output_text.delta", output_index: 0, delta: "partial" };

  it.each([["openai", /"finish_reason":"/], ["claude", /message_stop/]])("ends with an error for %s clients", async (source, success) => {
    const output = await translateStream([delta], source);
    expect(output).toContain("incomplete_upstream_stream");
    expect(output).not.toMatch(success);
  });

  it.each(["response.completed", "response.incomplete"])("stays successful after %s", async (type) => {
    const output = await translateStream([delta, { type, response: { id: "r", status: type.split(".")[1] } }], "openai");
    expect(output).toMatch(/"finish_reason":"/);
    expect(output).not.toContain("incomplete_upstream_stream");
  });
});

describe("upstream #4490 - Claude tool schemas", () => {
  const object = (properties, required) => ({ type: "object", properties, ...(required && { required }) });
  const text = { type: "string" };

  it("merges a root oneOf into one object and requires only shared fields", () => {
    const source = { oneOf: [object({ a: text, id: text }, ["a", "id"]), object({ b: text, id: text }, ["id"])] };
    const copy = structuredClone(source);
    expect(toClaudeInputSchema(source, undefined, "tool")).toEqual({ type: "object", properties: { a: text, id: text, b: text }, required: ["id"] });
    expect(source).toEqual(copy);
  });

  it("requires every allOf field and resolves local references, keeping nested unions", () => {
    const nested = { anyOf: [text, { type: "number" }] };
    const schema = toClaudeInputSchema({ type: "object", $defs: { first: object({ a: nested }, ["a"]) }, allOf: [{ $ref: "#/$defs/first" }, object({ b: text }, ["b"])] }, undefined, "tool");
    expect(schema.allOf).toBeUndefined();
    expect(schema.properties).toEqual({ a: nested, b: text });
    expect(schema.required).toEqual(["a", "b"]);
  });

  it("stops at a recursive reference", () => {
    const schema = toClaudeInputSchema({ $defs: { loop: { anyOf: [{ $ref: "#/$defs/loop" }] } }, anyOf: [{ $ref: "#/$defs/loop" }] }, undefined, "tool");
    expect(schema).toMatchObject({ type: "object", properties: {} });
    expect(schema.anyOf).toBeUndefined();
  });
});
