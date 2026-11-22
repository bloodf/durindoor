import { describe, expect, it } from "vitest";
import { antigravityToOpenAIRequest } from "../../open-sse/translator/request/antigravity-to-openai.js";

describe("Antigravity tool schemas", () => {
  it("removes defaults from nested properties without changing the input", () => {
    const parameters = { type: "OBJECT", properties: { x: { type: "STRING", default: "a" }, nested: { type: "OBJECT", properties: { y: { type: "NUMBER", default: 3 } } } } };
    const result = antigravityToOpenAIRequest("m", { request: { tools: [{ functionDeclarations: [{ name: "tool", parameters }] }] } }, false);
    expect(result.tools[0].function.parameters).toEqual({ type: "object", properties: { x: { type: "string" }, nested: { type: "object", properties: { y: { type: "number" } } } } });
    expect(parameters.properties.x.default).toBe("a");
  });
});
