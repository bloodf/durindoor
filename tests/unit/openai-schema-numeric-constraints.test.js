import { describe, expect, it } from "vitest";
import { coerceSchemaNumericConstraints, filterToOpenAIFormat } from "../../open-sse/translator/formats/openai.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { openaiResponsesToOpenAIRequest, openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";

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

  it("visits standard schema containers without changing annotations", () => {
    const defaultValue = { minimum: "101", nested: { multipleOf: "102" } };
    const examples = [{ maximum: "103", items: { minItems: "104" } }];
    const schema = {
      type: "object",
      default: structuredClone(defaultValue),
      examples: structuredClone(examples),
      properties: { value: { type: "number", minimum: "0.5" } },
      $defs: { value: { type: "number", minimum: "1" } },
      definitions: { value: { type: "number", maximum: "2" } },
      patternProperties: { "^x-": { type: "string", minLength: "3" } },
      dependentSchemas: { value: { type: "array", minItems: "4" } },
      dependencies: { value: { type: "number", minimum: "4.5" }, names: ["other"] },
      prefixItems: [{ type: "number", multipleOf: "5" }],
      items: { type: "number", minimum: "5.5" },
      additionalProperties: { type: "number", maximum: "5.6" },
      allOf: [{ type: "number", minimum: "5.7" }],
      anyOf: [{ type: "number", maximum: "5.8" }],
      oneOf: [{ type: "number", multipleOf: "5.9" }],
      contains: { type: "number", exclusiveMinimum: "6" }, minContains: "1", maxContains: "3",
      propertyNames: { type: "string", maxLength: "7" },
      if: { type: "object", minProperties: "8" },
      then: { type: "array", maxItems: "9" },
      else: { type: "number", exclusiveMaximum: "10" },
      not: { type: "number", minimum: "11" },
      unevaluatedProperties: { type: "number", maximum: "12" },
      unevaluatedItems: { type: "number", multipleOf: "13" },
      contentSchema: { type: "string", minLength: "14" },
    };

    const result = coerceSchemaNumericConstraints(schema);

    expect(result.default).toEqual(defaultValue);
    expect(result.examples).toEqual(examples);
    expect(result.properties.value.minimum).toBe(0.5);
    expect(result.$defs.value.minimum).toBe(1);
    expect(result.definitions.value.maximum).toBe(2);
    expect(result.patternProperties["^x-"].minLength).toBe(3);
    expect(result.dependentSchemas.value.minItems).toBe(4);
    expect(result.dependencies.value.minimum).toBe(4.5);
    expect(result.dependencies.names).toEqual(["other"]);
    expect(result.prefixItems[0].multipleOf).toBe(5);
    expect(result.contains.exclusiveMinimum).toBe(6);
    expect(result.minContains).toBe(1);
    expect(result.maxContains).toBe(3);
    expect(result.propertyNames.maxLength).toBe(7);
    expect(result.if.minProperties).toBe(8);
    expect(result.then.maxItems).toBe(9);
    expect(result.else.exclusiveMaximum).toBe(10);
    expect(result.items.minimum).toBe(5.5);
    expect(result.additionalProperties.maximum).toBe(5.6);
    expect(result.allOf[0].minimum).toBe(5.7);
    expect(result.anyOf[0].maximum).toBe(5.8);
    expect(result.oneOf[0].multipleOf).toBe(5.9);
    expect(result.not.minimum).toBe(11);
    expect(result.unevaluatedProperties.maximum).toBe(12);
    expect(result.unevaluatedItems.multipleOf).toBe(13);
    expect(result.contentSchema.minLength).toBe(14);
  });

  it("normalizes already-OpenAI tool schemas", () => {
    const body = { messages: [], tools: [{ type: "function", function: { name: "tool", parameters: { type: "object", minProperties: "1" } } }] };
    filterToOpenAIFormat(body);
    expect(body.tools[0].function.parameters.minProperties).toBe(1);
  });

  it("normalizes converter tool schemas without mutating source bodies", () => {
    const claudeBody = { messages: [], tools: [{ name: "tool", input_schema: { type: "object", minLength: "1" } }] };
    const claudeOriginal = structuredClone(claudeBody);
    const claude = claudeToOpenAIRequest("gpt-5", claudeBody, false);
    expect(claude.tools[0].function.parameters.minLength).toBe(1);
    expect(claudeBody).toEqual(claudeOriginal);

    const chatBody = { messages: [], tools: [{ type: "function", function: { name: "tool", parameters: { type: "object", minimum: "5" } } }] };
    const chatOriginal = structuredClone(chatBody);
    const toResponses = openaiToOpenAIResponsesRequest("gpt-5", chatBody, false, {});
    expect(toResponses.tools[0].parameters.minimum).toBe(5);
    expect(chatBody).toEqual(chatOriginal);

    const responsesBody = { input: [], tools: [{ type: "function", name: "tool", parameters: { type: "object", maximum: "9" } }] };
    const responsesOriginal = structuredClone(responsesBody);
    const fromResponses = openaiResponsesToOpenAIRequest("gpt-5", responsesBody, false, {});
    expect(fromResponses.tools[0].function.parameters.maximum).toBe(9);
    expect(responsesBody).toEqual(responsesOriginal);
  });

  it("normalizes outbound same-format Responses schemas without mutating input", () => {
    const body = {
      model: "gpt-5",
      input: [],
      tools: [{
        type: "function",
        name: "tool",
        parameters: { type: "object", contains: { type: "number", multipleOf: "2" }, minContains: "1" },
      }],
    };
    const original = structuredClone(body);

    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "gpt-5", body, false, null, "codex");

    expect(result.tools[0].parameters.contains.multipleOf).toBe(2);
    expect(result.tools[0].parameters.minContains).toBe(1);
    expect(body).toEqual(original);
  });
});
