import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

function requestWithSchema(schema) {
  return {
    messages: [{ role: "user", content: "Return structured data." }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "result", schema }
    }
  };
}

describe("OpenAI response_format -> Gemini responseSchema", () => {
  it("preserves nested nullable type arrays, anyOf, and oneOf without mutating the caller", () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: ["string", "null"] },
        details: {
          type: "object",
          properties: {
            count: {
              anyOf: [{ type: "integer" }, { type: "null" }]
            },
            metadata: {
              anyOf: [
                {
                  type: "object",
                  properties: { source: { type: "string" } },
                  required: ["source", "missing"]
                },
                { type: "null" }
              ]
            },
            labels: {
              type: "array",
              items: {
                oneOf: [{ type: "string" }, { type: "null" }]
              }
            }
          },
          required: ["count", "missing"]
        }
      },
      required: ["title", "details"]
    };
    const body = requestWithSchema(schema);
    const originalBody = structuredClone(body);

    const result = openaiToGeminiRequest("gemini-2.5-pro", body, false);

    expect(result.generationConfig.responseSchema).toEqual({
      type: "object",
      properties: {
        title: { type: "string", nullable: true },
        details: {
          type: "object",
          properties: {
            count: { type: "integer", nullable: true },
            metadata: {
              type: "object",
              properties: { source: { type: "string" } },
              required: ["source"],
              nullable: true
            },
            labels: {
              type: "array",
              items: { type: "string", nullable: true }
            }
          },
          required: ["count"]
        }
      },
      required: ["title", "details"]
    });
    expect(body).toEqual(originalBody);
    expect(result.generationConfig.responseMimeType).toBe("application/json");
    expect(result.tools).toBeUndefined();
  });

  it("keeps one-argument cleaner calls on existing null-flattening behavior", () => {
    const schema = {
      type: "object",
      properties: {
        typeArray: { type: ["string", "null"] },
        union: { anyOf: [{ type: "integer" }, { type: "null" }] }
      }
    };

    expect(cleanJSONSchemaForAntigravity(schema)).toEqual({
      type: "object",
      properties: {
        typeArray: { type: "string" },
        union: { type: "integer" }
      }
    });
  });

  it("gemini-2.5 with tools keeps tool mapping unchanged but omits responseSchema/responseMimeType", () => {
    // Gemini 2.5 rejects a request that declares both function tools and a
    // response schema with a 400 ("If you declare any tools and
    // response_model argument, Gemini will throw an error"). Only Gemini 3
    // documents combining structured output with function calling.
    const tool = {
      type: "function",
      function: {
        name: "record_note",
        parameters: {
          type: "object",
          properties: { note: { type: ["string", "null"], minLength: 1 } },
          required: ["note"]
        }
      }
    };
    const responseSchema = { type: "object", properties: { ok: { type: ["boolean", "null"] } } };
    const baseline = openaiToGeminiRequest("gemini-2.5-pro", {
      messages: [{ role: "user", content: "Record this." }],
      tools: [tool]
    }, false);
    const result = openaiToGeminiRequest("gemini-2.5-pro", {
      messages: [{ role: "user", content: "Record this." }],
      tools: [tool],
      response_format: { type: "json_schema", json_schema: { name: "result", schema: responseSchema } }
    }, false);

    expect(result.tools).toEqual(baseline.tools);
    expect(result.tools[0].functionDeclarations[0].parameters.properties.note).toEqual({ type: "string" });
    expect(result.generationConfig.responseSchema).toBeUndefined();
    expect(result.generationConfig.responseMimeType).toBeUndefined();
  });

  it("gemini-3 with tools emits both tool mapping and responseSchema/responseMimeType", () => {
    const tool = {
      type: "function",
      function: {
        name: "record_note",
        parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] }
      }
    };
    const responseSchema = { type: "object", properties: { ok: { type: ["boolean", "null"] } } };
    const result = openaiToGeminiRequest("gemini-3-pro-preview", {
      messages: [{ role: "user", content: "Record this." }],
      tools: [tool],
      response_format: { type: "json_schema", json_schema: { name: "result", schema: responseSchema } }
    }, false);

    expect(result.tools[0].functionDeclarations[0].name).toBe("record_note");
    expect(result.generationConfig.responseMimeType).toBe("application/json");
    expect(result.generationConfig.responseSchema.properties.ok).toEqual({ type: "boolean", nullable: true });
  });

  it("emits responseSchema/responseMimeType on any model when no tools are declared", () => {
    const responseSchema = { type: "object", properties: { ok: { type: "boolean" } } };
    const result = openaiToGeminiRequest("gemini-2.5-flash", {
      messages: [{ role: "user", content: "Record this." }],
      response_format: { type: "json_schema", json_schema: { name: "result", schema: responseSchema } }
    }, false);

    expect(result.tools).toBeUndefined();
    expect(result.generationConfig.responseMimeType).toBe("application/json");
    expect(result.generationConfig.responseSchema).toEqual(responseSchema);
  });

  it("Antigravity route strips both responseSchema and responseMimeType, preserving tools and other generationConfig", async () => {
    const { openaiToAntigravityRequest } = await import("../../open-sse/translator/request/openai-to-gemini.js");
    const tool = {
      type: "function",
      function: {
        name: "record_note",
        parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] }
      }
    };
    const result = openaiToAntigravityRequest("gemini-3-pro-preview", {
      messages: [{ role: "user", content: "Record this." }],
      tools: [tool],
      temperature: 0.3,
      response_format: { type: "json_schema", json_schema: { name: "result", schema: { type: "object", properties: { ok: { type: "boolean" } } } } }
    }, false);

    expect(result.request.generationConfig.responseSchema).toBeUndefined();
    expect(result.request.generationConfig.responseMimeType).toBeUndefined();
    expect(result.request.generationConfig.temperature).toBe(0.3);
    expect(result.request.tools?.[0]?.functionDeclarations?.[0]?.name).toBe("record_note");
  });

  it("leaves a pure-null union (no non-null winner) to the existing placeholder path", () => {
    const schema = {
      type: "object",
      properties: { onlyNull: { anyOf: [{ type: "null" }] } }
    };

    const result = cleanJSONSchemaForAntigravity(schema, { preserveNullable: true });

    expect(result.properties.onlyNull).toEqual({
      type: "object",
      properties: {
        reason: { type: "string", description: "Brief explanation of why you are calling this tool" }
      },
      required: ["reason"]
    });
    expect(result.properties.onlyNull.nullable).toBeUndefined();
  });

  it("keeps nullable:true on the union even when the non-null branch carries nullable:false", () => {
    const schema = {
      type: "object",
      properties: {
        flag: {
          anyOf: [
            { type: "string", nullable: false },
            { type: "null" }
          ]
        }
      }
    };

    const result = cleanJSONSchemaForAntigravity(schema, { preserveNullable: true });

    expect(result.properties.flag).toEqual({ type: "string", nullable: true });
  });

  it("does not treat caller marker-like keys as nullable tracking state", () => {
    const schema = {
      type: "object",
      properties: {
        ordinary: { type: "string", _geminiNullable: true },
        nullableUnion: {
          anyOf: [{ type: "integer", _geminiNullable: false }, { type: "null" }]
        }
      }
    };

    const result = cleanJSONSchemaForAntigravity(schema, { preserveNullable: true });

    expect(result.properties.ordinary).toEqual({ type: "string", _geminiNullable: true });
    expect(result.properties.ordinary.nullable).toBeUndefined();
    expect(result.properties.nullableUnion).toEqual({ type: "integer", _geminiNullable: false, nullable: true });
  });

  it("preserves a nullable nested union selected from an outer union", () => {
    const schema = {
      type: "object",
      properties: {
        value: {
          anyOf: [
            { oneOf: [{ type: "string" }, { type: "null" }] }
          ]
        }
      }
    };

    const result = cleanJSONSchemaForAntigravity(schema, { preserveNullable: true });

    expect(result.properties.value).toEqual({ type: "string", nullable: true });
  });
});
