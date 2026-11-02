// #1334: numeric-string constraints coerce, malformed schemas 400.
// #1353: non-object schemas never reach a Claude upstream.
import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { normalizeToolSchema } from "../../open-sse/translator/concerns/toolSchema.js";

const chatTool = (parameters) => ({ type: "function", function: { name: "lookup", description: "d", parameters } });
const toClaude = (parameters) =>
  translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", { messages: [{ role: "user", content: "hi" }], tools: [chatTool(parameters)] }, false);
const toCommandCode = (parameters) =>
  translateRequest(FORMATS.OPENAI, FORMATS.COMMANDCODE, "m", { messages: [{ role: "user", content: "hi" }], tools: [chatTool(parameters)] }, false);
const responsesToClaude = (parameters) =>
  translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "claude-sonnet-4-5", {
    input: "hi",
    tools: [{ type: "function", name: "lookup", description: "d", parameters }],
  }, false);

const rejection = expect.objectContaining({ statusCode: 400, message: expect.stringContaining('"lookup"') });

describe("#1353 non-object tool schemas on Claude-bound paths", () => {
  it.each([
    ["string", { type: "string" }],
    ["array", { type: "array", items: { type: "string" } }],
  ])("rejects a %s schema on every Claude-bound path", (_label, schema) => {
    for (const run of [toClaude, toCommandCode, responsesToClaude]) {
      expect(() => run(schema)).toThrowError(rejection);
    }
  });

  it.each([
    ["type null (Codex)", { type: null, properties: { q: { type: "string" } } }],
    ["type [object, null]", { type: ["object", "null"], properties: { q: { type: "string" } } }],
    ["type [object]", { type: ["object"], properties: { q: { type: "string" } } }],
  ])("treats a root %s as an object schema", (_label, schema) => {
    for (const run of [toClaude, toCommandCode, responsesToClaude]) {
      const out = run(schema);
      const tools = out.tools ?? out.params.tools; // CommandCode nests the body under `params`
      expect(tools[0].input_schema).toEqual({ type: "object", properties: { q: { type: "string" } } });
    }
  });

  it("does not reject a typeless combinator root", () => {
    const schema = { anyOf: [{ type: "object", properties: { a: { type: "string" } } }, { type: "object", properties: { b: { type: "number" } } }] };
    expect(toClaude(schema).tools[0].input_schema.anyOf).toEqual(schema.anyOf);
  });

  it("still lowers a missing-type schema with properties to an object", () => {
    const schema = { properties: { q: { type: "string" } } };
    expect(toClaude(schema).tools[0].input_schema).toEqual({ type: "object", properties: { q: { type: "string" } } });
  });
});

describe("#1334 normalizeToolSchema", () => {
  it("coerces nested numeric-string constraints and leaves non-numeric strings", () => {
    const schema = {
      type: "object",
      properties: {
        list: { type: "array", maxItems: "3", items: { type: "string", minLength: "2" } },
        pick: { anyOf: [{ type: "integer", maximum: "9" }, { type: "string", maxLength: "abc" }] },
      },
      required: ["list"],
    };
    const original = structuredClone(schema);
    expect(normalizeToolSchema(schema, "lookup")).toEqual({
      type: "object",
      properties: {
        list: { type: "array", maxItems: 3, items: { type: "string", minLength: 2 } },
        pick: { anyOf: [{ type: "integer", maximum: 9 }, { type: "string", maxLength: "abc" }] },
      },
      required: ["list"],
    });
    expect(schema).toEqual(original);
  });

  it.each([
    ["properties array", { type: "object", properties: [] }],
    ["null property", { type: "object", properties: { x: null } }],
    ["string required", { type: "object", properties: {}, required: "x" }],
    ["non-string required entry", { type: "object", properties: {}, required: [1] }],
    ["nested null property", { type: "object", properties: { o: { type: "object", properties: { y: null } } } }],
  ])("rejects %s with a 400 naming the tool", (_label, schema) => {
    expect(() => normalizeToolSchema(schema, "lookup")).toThrowError(rejection);
  });

  it("lifts draft-3 nested required:true into the parent required list", () => {
    const schema = {
      type: "object",
      properties: {
        path: { type: "string", required: true },
        mode: { type: "string", required: false },
        opts: { type: "object", properties: { deep: { type: "boolean", required: true } } },
      },
      required: ["mode"],
    };
    expect(normalizeToolSchema(schema, "lookup")).toEqual({
      type: "object",
      properties: {
        path: { type: "string" },
        mode: { type: "string" },
        opts: { type: "object", properties: { deep: { type: "boolean" } }, required: ["deep"] },
      },
      required: ["mode", "path"],
    });
  });

  it("accepts draft-3 nested required:true on Claude, Gemini, and Responses", () => {
    const parameters = { type: "object", properties: { path: { type: "string", required: true } } };
    const body = { messages: [{ role: "user", content: "hi" }], tools: [chatTool(parameters)] };
    for (const [target, model] of [[FORMATS.CLAUDE, "claude-sonnet-4-5"], [FORMATS.GEMINI, "gemini-2.5-pro"], [FORMATS.OPENAI_RESPONSES, "m"]]) {
      expect(() => translateRequest(FORMATS.OPENAI, target, model, structuredClone(body), false)).not.toThrow();
    }
    expect(toClaude(parameters).tools[0].input_schema.required).toEqual(["path"]);
  });

  it("keeps properties:null and boolean subschemas", () => {
    expect(normalizeToolSchema({ type: "object", properties: null }, "lookup")).toEqual({ type: "object", properties: null });
    expect(normalizeToolSchema({ type: "object", properties: { any: true } }, "lookup")).toEqual({ type: "object", properties: { any: true } });
  });
});
