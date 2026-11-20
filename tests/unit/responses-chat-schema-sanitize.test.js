import { expect, it } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

it("repairs truncated enum arrays in Responses function and namespace tools", () => {
  const parameters = { type: "object", properties: { option: { anyOf: [{ type: "string", enum: "[MaxDepth]" }, { type: "string", enum: { 0: "a", 1: "b" } }] } } };
  const tools = [{ type: "function", name: "pick", parameters }, { type: "namespace", name: "ns", tools: [{ name: "pick", parameters }] }];
  const result = openaiResponsesToOpenAIRequest("model", { input: "hello", tools }, false, {});
  for (const tool of result.tools) {
    const choices = tool.function.parameters.properties.option.anyOf;
    expect(choices[0]).not.toHaveProperty("enum");
    expect(choices[1].enum).toEqual(["a", "b"]);
  }
  expect(parameters.properties.option.anyOf[0].enum).toBe("[MaxDepth]");
});
