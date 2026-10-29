import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

/**
 * Guards port of upstream decolua/9router#5257 / `8db1f4ae`:
 * Gemini's protobuf Schema rejects tool schemas where `items` or `properties`
 * values lack a valid type predicate (e.g. `items: {}`, untyped property,
 * `items` on a non-array). Also verifies #4620: a parameter literally named
 * `properties` still survives name-map-aware enforcement.
 */
describe("cleanJSONSchemaForAntigravity handles array items and type predicates", () => {
  it("removes items field when type is not array (fixing: field predicate failed: $type == Type.ARRAY)", () => {
    const schema = {
      type: "object",
      properties: {
        source_paths: {
          type: "array",
          items: {
            type: [
              "null",
              "boolean",
              "object",
              "array",
              "number",
              "string"
            ],
            items: {}
          },
          description: "File paths"
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    const items = cleaned.properties.source_paths.items;

    // Items element itself must not have an "items" property unless it is an array
    expect(items.type).not.toBe("boolean");
    expect(items.type).toBe("string");
    expect(items).not.toHaveProperty("items");
  });

  it("ensures no non-array schema carries an items field", () => {
    const schema = {
      type: "object",
      properties: {
        scalar: {
          type: "string",
          items: { type: "string" }
        },
        bool: {
          type: "boolean",
          items: {}
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(cleaned.properties.scalar).not.toHaveProperty("items");
    expect(cleaned.properties.bool).not.toHaveProperty("items");
  });

  it("ensures no non-object schema carries properties or required", () => {
    const schema = {
      type: "object",
      properties: {
        list: {
          type: "array",
          items: { type: "string" },
          properties: { foo: { type: "string" } },
          required: ["foo"]
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(cleaned.properties.list).not.toHaveProperty("properties");
    expect(cleaned.properties.list).not.toHaveProperty("required");
  });

  it("defaults empty array items to string instead of object with reason placeholder", () => {
    const schema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: {}
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(cleaned.properties.tags.items.type).toBe("string");
    expect(cleaned.properties.tags.items).not.toHaveProperty("properties");
  });

  it("gives untyped property schemas a valid Gemini type", () => {
    const schema = {
      type: "object",
      properties: {
        bare: {},
        nested: { properties: { id: { type: "string" } } }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(cleaned.properties.bare.type).toBe("object");
    expect(cleaned.properties.bare.properties).toBeDefined();
    expect(cleaned.properties.nested.type).toBe("object");
    expect(cleaned.properties.nested.properties.id).toEqual({ type: "string" });
  });

  it("preserves a tool parameter literally named properties (#4620)", () => {
    const original = {
      type: "object",
      properties: {
        properties: { type: "string", description: "literal param name" },
        other: { type: "integer" }
      },
      required: ["properties"]
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(original));

    expect(cleaned.properties.properties).toEqual({
      type: "string",
      description: "literal param name"
    });
    expect(cleaned.properties.other).toEqual({ type: "integer" });
    expect(cleaned.required).toEqual(["properties"]);
    // Callers clone before cleaning; the pristine source object is untouched.
    expect(original.properties.properties).toEqual({
      type: "string",
      description: "literal param name"
    });
  });

  it("leaves already-valid schemas unchanged", () => {
    const original = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
        count: { type: "integer" }
      },
      required: ["tags"]
    };
    const schema = structuredClone(original);
    const cleaned = cleanJSONSchemaForAntigravity(schema);
    expect(cleaned).toEqual(original);
  });
});
