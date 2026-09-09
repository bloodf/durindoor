import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity, UNSUPPORTED_SCHEMA_CONSTRAINTS } from "../../open-sse/translator/formats/gemini.js";

/**
 * Guards the upstream port of decolua/9router commit
 * f6c59d30b0215986e703ff38e2ce31dfea7d2a0a:
 * "fix(gemini): convert prefixItems and ensure array items in schema sanitizer".
 *
 * Gemini cannot express JSON Schema tuples (`prefixItems`) and rejects any
 * `type: "array"` schema that lacks `items` with a "missing field" error.
 * The sanitizer must convert `prefixItems` into `items`, strip the leftover
 * tuple keywords, and fill a permissive `items` placeholder on bare arrays.
 */
describe("UNSUPPORTED_SCHEMA_CONSTRAINTS includes tuple keywords", () => {
  it("lists prefixItems and additionalItems as unsupported keywords", () => {
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("prefixItems");
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("additionalItems");
  });
});

describe("cleanJSONSchemaForAntigravity converts prefixItems", () => {
  it("converts a single non-null prefixItems variant to items", () => {
    const schema = {
      type: "object",
      properties: {
        tags: { type: "array", prefixItems: [{ type: "string" }] }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.tags.prefixItems).toBeUndefined();
    expect(result.properties.tags.items).toEqual({ type: "string" });
  });

  it("filters null variants before converting prefixItems", () => {
    const schema = {
      type: "object",
      properties: {
        maybe: { type: "array", prefixItems: [{ type: "null" }, { type: "string" }] }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.maybe.prefixItems).toBeUndefined();
    expect(result.properties.maybe.items).toEqual({ type: "string" });
  });

  it("converts multi-variant tuples to an items schema (flattened anyOf)", () => {
    const schema = {
      type: "object",
      properties: {
        pair: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    // convertPrefixItems emits { anyOf: [...] } for multi-variant tuples; the
    // existing flattenAnyOfOneOf pass then picks a single variant for Gemini.
    expect(result.properties.pair.prefixItems).toBeUndefined();
    expect(result.properties.pair.items).toBeDefined();
    expect(result.properties.pair.items.type).toBe("string");
  });

  it("strips prefixItems even when items already exists", () => {
    const schema = {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: { type: "integer" },
          prefixItems: [{ type: "string" }],
          additionalItems: false
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.values.prefixItems).toBeUndefined();
    expect(result.properties.values.additionalItems).toBeUndefined();
    expect(result.properties.values.items).toEqual({ type: "integer" });
  });

  it("converts prefixItems nested inside items schemas", () => {
    const schema = {
      type: "object",
      properties: {
        matrix: {
          type: "array",
          items: { type: "array", prefixItems: [{ type: "number" }] }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.matrix.items.prefixItems).toBeUndefined();
    expect(result.properties.matrix.items.items).toEqual({ type: "number" });
  });
});

describe("cleanJSONSchemaForAntigravity ensures array items", () => {
  it("fills a permissive items placeholder on a bare type:array schema", () => {
    const schema = {
      type: "object",
      properties: {
        anything: { type: "array" }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.anything.items).toEqual({ type: "string" });
  });

  it("does not overwrite an existing items schema", () => {
    const schema = {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "integer" } }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.ids.items).toEqual({ type: "integer" });
  });

  it("fills items on nested bare arrays", () => {
    const schema = {
      type: "object",
      properties: {
        rows: { type: "array", items: { type: "array" } }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.rows.items.items).toEqual({ type: "string" });
  });
});
