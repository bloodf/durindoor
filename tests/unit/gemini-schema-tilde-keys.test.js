import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

/**
 * Standard Schema libraries (Zod 4, Valibot, ArkType) tag vendor metadata with
 * "~"-prefixed keys such as "~optional". Gemini rejects any unknown key with a
 * 400 on the whole tool list, so these must be stripped like "x-" keys.
 */
describe("cleanJSONSchemaForAntigravity strips ~-prefixed keys", () => {
  it("removes ~optional from a property subschema and keeps property names", () => {
    const schema = {
      type: "object",
      "~standard": { vendor: "zod" },
      properties: {
        "~name": { type: "string", "~optional": true },
        path: { type: "string", "~optional": true, description: "file path" }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result["~standard"]).toBeUndefined();
    expect(result.properties.path).toEqual({ type: "string", description: "file path" });
    expect(result.properties["~name"]).toEqual({ type: "string" });
  });
});
