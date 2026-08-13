import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

describe("Gemini schema name-map walking", () => {
  it("preserves property names while stripping unsupported schema-node keys", () => {
    const schema = {
      type: "object",
      properties: {
        value: { type: "string" },
        format: { type: "string" },
        nested: {
          type: "object",
          value: "object",
          properties: {
            email: { type: "string", format: "email", default: "unknown" },
          },
        },
      },
    };

    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(result.properties.value).toEqual({ type: "string" });
    expect(result.properties.format).toEqual({ type: "string" });
    expect(result.properties.nested).toEqual({
      type: "object",
      properties: { email: { type: "string" } },
    });
  });
});
