import { describe, expect, it } from "vitest";
import { coerceSchemaNumericConstraints, filterToOpenAIFormat } from "../../open-sse/translator/formats/openai.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { openaiResponsesToOpenAIRequest, openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("OpenAI tool schema numeric constraints", () => {
  it("coerces nested numeric strings without changing non-numeric values", () => {
    const schema = { type: "object", properties: { name: { type: "string", minLength: "1", maxLength: "64" }, score: { type: "number", minimum: "0.5", maximum: "many" } } };
    expect(coerceSchemaNumericConstraints(schema)).toMatchObject({
      properties: {
        name: { minLength: 1, maxLength: 64 },
        score: { minimum: 0.5, maximum: "many" },
      },
    });
  });

  it("normalizes already-OpenAI tool schemas", () => {
    const body = { messages: [], tools: [{ type: "function", function: { name: "tool", parameters: { type: "object", minProperties: "1" } } }] };
    filterToOpenAIFormat(body);
    expect(body.tools[0].function.parameters.minProperties).toBe(1);
  });

  it("normalizes Claude and Responses converter tool schemas", () => {
    const claude = claudeToOpenAIRequest("gpt-5", { messages: [], tools: [{ name: "tool", input_schema: { type: "object", minLength: "1" } }] }, false);
    expect(claude.tools[0].function.parameters.minLength).toBe(1);

    const toResponses = openaiToOpenAIResponsesRequest("gpt-5", { messages: [], tools: [{ type: "function", function: { name: "tool", parameters: { type: "object", minimum: "5" } } }] }, false, {});
    expect(toResponses.tools[0].parameters.minimum).toBe(5);

    const fromResponses = openaiResponsesToOpenAIRequest("gpt-5", { input: [], tools: [{ type: "function", name: "tool", parameters: { type: "object", maximum: "9" } }] }, false, {});
    expect(fromResponses.tools[0].function.parameters.maximum).toBe(9);
  });
});
