import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const translate = (tools) => openaiToClaudeRequest(
  "claude-sonnet-4.5",
  { messages: [{ role: "user", content: "hi" }], tools },
  false
).tools;

const stringBounds = () => ({
  type: "object",
  minProperties: "1",
  properties: { value: { type: "string", minLength: "1", maxLength: "200" } },
});
const numericBounds = {
  type: "object",
  minProperties: 1,
  properties: { value: { type: "string", minLength: 1, maxLength: 200 } },
};

describe("upstream #4938: Claude custom tool input schemas are normalized", () => {
  it("unwraps a { type: custom, custom } tool", () => {
    const [tool] = translate([{
      type: "custom",
      custom: { name: "wrapped", description: "Wrapped tool", input_schema: stringBounds() },
    }]);

    expect(tool).toMatchObject({ name: "wrapped", description: "Wrapped tool", input_schema: numericBounds });
    expect(tool).not.toHaveProperty("custom");
    expect(tool).not.toHaveProperty("type");
  });

  it("gives a custom tool without a schema an object input_schema", () => {
    const [tool] = translate([{ type: "custom", custom: { name: "freeform", format: { type: "text" } } }]);

    expect(tool.name).toBe("freeform");
    expect(tool.input_schema).toEqual({ type: "object", properties: {}, required: [] });
  });

  it("normalizes a Claude-shaped custom tool, keeps its other fields and does not mutate the caller", () => {
    const original = { type: "custom", name: "native", input_schema: stringBounds(), eager_input_streaming: true };
    const snapshot = structuredClone(original);

    const [tool] = translate([original]);

    expect(tool).toMatchObject({ type: "custom", name: "native", eager_input_streaming: true, input_schema: numericBounds });
    expect(original).toEqual(snapshot);
  });

  it("still passes other built-in tools through", () => {
    const [tool] = translate([{ type: "web_search_20250305", name: "web_search" }]);

    expect(tool).toMatchObject({ type: "web_search_20250305", name: "web_search" });
    expect(tool).not.toHaveProperty("input_schema");
  });
});
