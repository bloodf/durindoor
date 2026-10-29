import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const translateTool = (tool) => translateRequest(
  FORMATS.OPENAI,
  FORMATS.CLAUDE,
  "m",
  { tools: [{ type: "function", function: { name: "lookup", ...tool } }] },
  true,
  null,
  "anthropic-compatible-x"
).tools[0].input_schema;

describe("Claude tool input schema normalization (#1350)", () => {
  it("normalizes empty parameters to an object schema", () => {
    expect(translateTool({ parameters: {} })).toEqual({ type: "object", properties: {} });
  });

  it("adds object type when parameters only define properties", () => {
    expect(translateTool({ parameters: { properties: { q: { type: "string" } } } }))
      .toEqual({ type: "object", properties: { q: { type: "string" } } });
  });

  it("adds missing properties to object type", () => {
    expect(translateTool({ parameters: { type: "object" } }))
      .toEqual({ type: "object", properties: {} });
  });

  it("preserves full schema and does not mutate input", () => {
    const schema = { type: "object", properties: { q: { type: "string" } }, additionalProperties: false };
    const original = structuredClone(schema);
    expect(translateTool({ parameters: schema })).toEqual(original);
    expect(schema).toEqual(original);
  });

  it.each([undefined, null, [], "x", 5])("defaults non-object parameters (%s)", (parameters) => {
    const tool = parameters === undefined ? {} : { parameters };
    expect(translateTool(tool)).toEqual({ type: "object", properties: {}, required: [] });
  });

  it("normalizes parameters first when empty parameters coexist with valid input_schema", () => {
    expect(translateTool({ parameters: {}, input_schema: { type: "string" } }))
      .toEqual({ type: "object", properties: {} });
  });
});
