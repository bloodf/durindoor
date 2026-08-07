import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity, UNSUPPORTED_SCHEMA_CONSTRAINTS } from "../../open-sse/translator/formats/gemini.js";
import { coerceSchemaNumericConstraints } from "../../open-sse/translator/formats/openai.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

/**
 * Guards fix for issue #2309:
 * Gemini API rejects tool schemas that contain "multipleOf" — it must be
 * stripped from function declaration parameters before dispatch.
 */
describe("UNSUPPORTED_SCHEMA_CONSTRAINTS includes multipleOf", () => {
  it("lists multipleOf as an unsupported keyword", () => {
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("multipleOf");
  });
});

describe("advanced unsupported schema constraints", () => {
  it("strips keywords Gemini has no field for", () => {
    const keywords = ["uniqueItems", "prefixItems", "contains", "unevaluatedProperties", "unevaluatedItems", "contentSchema"];
    for (const keyword of keywords) expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain(keyword);
  });
});

describe("standard schema containers", () => {
  it("strips unsupported container keywords before Gemini dispatch", () => {
    const schema = {
      type: "object",
      properties: {
        nested: {
          type: "object",
          $defs: { value: { type: "number", multipleOf: 2 } },
          definitions: { value: { type: "number", multipleOf: 2 } },
          patternProperties: { "^x-": { type: "number", multipleOf: 2 } },
          dependentSchemas: { value: { type: "number", multipleOf: 2 } },
          dependencies: { value: { type: "number", multipleOf: 2 } },
          prefixItems: [{ type: "number", multipleOf: 2 }],
          contains: { type: "number", multipleOf: 2 }, minContains: 1, maxContains: 3,
          propertyNames: { type: "string", minLength: 1 },
          if: { type: "number", multipleOf: 2 },
          then: { type: "number", multipleOf: 2 },
          else: { type: "number", multipleOf: 2 },
          not: { type: "number", multipleOf: 2 },
          unevaluatedProperties: { type: "number", multipleOf: 2 },
          unevaluatedItems: { type: "number", multipleOf: 2 },
          contentSchema: { type: "number", multipleOf: 2 },
        },
      },
    };

    const result = cleanJSONSchemaForAntigravity(schema);

    for (const keyword of [
      "$defs", "definitions", "patternProperties", "dependentSchemas", "dependencies",
      "prefixItems", "contains", "propertyNames", "if", "then", "else", "not",
      "minContains", "maxContains", "unevaluatedProperties", "unevaluatedItems", "contentSchema",
    ]) {
      expect(result.properties.nested[keyword]).toBeUndefined();
    }
  });

  it("does not mutate source tool schemas while converting Claude models", () => {
    const body = {
      messages: [{ role: "user", content: "hello" }],
      tools: [{
        type: "function",
        function: {
          name: "tool",
          parameters: {
            type: "object",
            default: { multipleOf: 2 },
            examples: [{ minimum: 1 }],
            prefixItems: [{ type: ["null", "number"], multipleOf: 2, "x-extra": true }],
          },
        },
      }],
    };
    const original = structuredClone(body);

    const result = openaiToAntigravityRequest("claude-opus-4-6", body, false);

    expect(body).toEqual(original);
    expect(result.request.tools[0].functionDeclarations[0].parameters.prefixItems).toBeUndefined();
  });
});

describe("cleanJSONSchemaForAntigravity strips multipleOf", () => {
  it("removes multipleOf from a top-level number property", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "integer", multipleOf: 5 }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.count.multipleOf).toBeUndefined();
    expect(result.properties.count.type).toBe("integer");
  });

  it("removes multipleOf from nested items schemas", () => {
    const schema = {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: { type: "number", multipleOf: 0.1 }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.values.items.multipleOf).toBeUndefined();
  });

  it("does not strip other numeric keywords like minimum/maximum", () => {
    const schema = {
      type: "object",
      properties: {
        age: { type: "integer", minimum: 0, maximum: 150, multipleOf: 1 }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.age.multipleOf).toBeUndefined();
    expect(result.properties.age.minimum).toBe(0);
    expect(result.properties.age.maximum).toBe(150);
  });
});

describe("cleanJSONSchemaForAntigravity schema-node traversal", () => {
  it("preserves parameter names that collide with schema keywords", () => {
    const schema = {
      type: "object",
      multipleOf: 10,
      "x-custom": { remove: true },
      properties: {
        multipleOf: { type: "number", multipleOf: 5 },
        contains: {
          type: "array",
          contains: { type: "string" },
          items: { const: 7 },
        },
        "x-custom": {
          properties: {
            const: { const: "fixed" },
            nested: {
              type: "array",
              items: {
                anyOf: [
                  { type: "null" },
                  { properties: { value: { type: "integer", multipleOf: 2 } }, required: ["value"] },
                ],
              },
            },
          },
          required: ["const", "nested"],
        },
        const: {
          oneOf: [
            { type: "null" },
            { type: ["null", "integer"], multipleOf: 3 },
          ],
        },
        default: { type: "string", default: { minimum: "leave annotation data alone" } },
        combined: {
          allOf: [
            { properties: { left: { type: "string" } }, required: ["left"] },
            { properties: { right: { type: "number", multipleOf: 0.5 } }, required: ["right"] },
          ],
        },
      },
      required: ["multipleOf", "contains", "x-custom", "const", "default", "combined"],
    };

    const result = cleanJSONSchemaForAntigravity(schema);

    expect(Object.keys(result.properties)).toEqual(["multipleOf", "contains", "x-custom", "const", "default", "combined"]);
    expect(result.required).toEqual(["multipleOf", "contains", "x-custom", "const", "default", "combined"]);
    expect(result.multipleOf).toBeUndefined();
    expect(result["x-custom"]).toBeUndefined();
    expect(result.properties.multipleOf).toEqual({ type: "number" });
    expect(result.properties.contains.contains).toBeUndefined();
    expect(result.properties.contains.items).toEqual({ enum: ["7"], type: "string" });
    expect(result.properties["x-custom"].required).toEqual(["const", "nested"]);
    expect(result.properties["x-custom"].properties.const).toEqual({ enum: ["fixed"], type: "string" });
    expect(result.properties["x-custom"].properties.nested.items).toEqual({
      properties: { value: { type: "integer" } },
      required: ["value"],
      type: "object",
    });
    expect(result.properties.const).toEqual({ type: "integer" });
    expect(result.properties.default).toEqual({ type: "string" });
    expect(result.properties.combined).toEqual({
      properties: { left: { type: "string" }, right: { type: "number" } },
      required: ["left", "right"],
      type: "object",
    });
  });
});

describe("coerceSchemaNumericConstraints schema-node traversal", () => {
  it("normalizes schema nodes without mutating annotation payloads", () => {
    const defaultValue = { minimum: "1", nested: { multipleOf: "2" } };
    const examples = [{ maximum: "3", items: { minItems: "4" } }];
    const schema = {
      type: "object",
      default: structuredClone(defaultValue),
      examples: structuredClone(examples),
      properties: {
        minimum: { type: "string", minLength: "5" },
        nested: {
          anyOf: [{ type: "number", minimum: "6" }],
          additionalProperties: { type: "array", minItems: "7" },
        },
      },
    };

    const result = coerceSchemaNumericConstraints(schema);

    expect(result.default).toEqual(defaultValue);
    expect(result.examples).toEqual(examples);
    expect(result.properties.minimum.minLength).toBe(5);
    expect(result.properties.nested.anyOf[0].minimum).toBe(6);
    expect(result.properties.nested.additionalProperties.minItems).toBe(7);
  });
});
