import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

/**
 * Guards port of upstream fix e3e3e235f:
 * After stripping $ref, a tool parameter schema that collapses to a bare
 * object (or empty object) must carry a placeholder property so Gemini
 * (and Antigravity) accepts the function declaration.
 */
describe("cleanJSONSchemaForAntigravity fills empty schemas after $ref strip", () => {
  it("adds a placeholder to a bare {} schema", () => {
    const result = cleanJSONSchemaForAntigravity({});
    expect(result).toMatchObject({
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool"
        }
      },
      required: ["reason"]
    });
  });

  it("adds a placeholder to a stripped object schema that ends up empty", () => {
    // Simulates a $ref-only schema that, after dereference/strip, becomes
    // type: "object" with no properties.
    const schema = { type: "object" };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result).toMatchObject({
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool"
        }
      },
      required: ["reason"]
    });
  });

  it("adds a placeholder to a nested empty object after stripping", () => {
    const schema = {
      type: "object",
      properties: {
        child: {}
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.child).toMatchObject({
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool"
        }
      },
      required: ["reason"]
    });
  });

  it("does not mutate a populated object schema", () => {
    const original = {
      type: "object",
      properties: {
        name: { type: "string" }
      },
      required: ["name"]
    };
    const schema = structuredClone(original);
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result).toEqual(original);
  });
});
