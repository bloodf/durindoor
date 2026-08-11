import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

/**
 * Guards port of upstream decolua/9router#3082 / #3114 (root cause #2884):
 * inside cleanJSONSchemaForAntigravity, the inner closures cleanupRequired and
 * addPlaceholders recursed via bare Object.values(obj), walking straight into
 * the `properties` name-map as if it were a schema node. Name-map keys are
 * user-chosen parameter names, not schema keywords — a parameter literally
 * named "required", "type", or "properties" must survive untouched.
 *
 * ensureObjectType was already name-map-aware on current main; this port
 * extends the same property-values + items traversal rule to cleanupRequired,
 * addPlaceholders, and removeUnsupportedKeywords. removeUnsupportedKeywords
 * was also generic-recursing via Object.keys/values, so a parameter named
 * `default`, `format`, `minLength`, or any `x-` extension was being deleted
 * from the properties name-map. The keyword-name regression case below is
 * the audit that surfaced it.
 */
describe("cleanJSONSchemaForAntigravity — name-map walking (#2884)", () => {
  it("does not delete a parameter literally named 'required' (exact repro)", () => {
    const schema = {
      type: "object",
      properties: {
        required: ["ghost"],
        properties: { type: "object", properties: { x: { type: "string" } } },
      },
    };

    const out = cleanJSONSchemaForAntigravity(structuredClone(schema));

    // Buggy behavior deleted the "required" param entirely because the
    // properties name-map itself had a "required" key and a "properties"
    // key, so cleanupRequired mistook the map for a schema node.
    expect(out.properties).toHaveProperty("required");
    expect(out.properties.required).toEqual(["ghost"]);
    expect(out.properties.properties).toMatchObject({
      type: "object",
      properties: { x: { type: "string" } },
    });
  });

  it("preserves a parameter named 'type' nested under a name-map", () => {
    const schema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            type: { type: "string", description: "kind of thing" },
          },
        },
      },
    };

    const out = cleanJSONSchemaForAntigravity(structuredClone(schema));

    // The param named "type" must remain a real schema node under
    // properties.outer.properties.type, not be mistaken for the outer
    // object's own `type` keyword or stripped away.
    expect(out.properties.outer.properties).toHaveProperty("type");
    expect(out.properties.outer.properties.type).toMatchObject({ type: "string" });
    expect(out.properties.outer.type).toBe("object");
  });

  it("still prunes a genuinely ghost required entry on a real schema node", () => {
    const schema = {
      type: "object",
      properties: {
        wrapper: {
          type: "object",
          properties: { x: { type: "string" } },
          required: ["x", "ghost-field"],
        },
      },
    };

    const out = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(out.properties.wrapper.required).toEqual(["x"]);
  });

  it("preserves parameter names that match unsupported schema keywords", () => {
    const schema = {
      type: "object",
      properties: {
        default: { type: "string" },
        format: { type: "string" },
        minLength: { type: "string" },
        "x-client": { type: "string" },
        actual: { type: "string", default: "value", format: "email", minLength: 1, "x-client": true },
      },
    };

    const out = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(out.properties).toMatchObject({
      default: { type: "string" },
      format: { type: "string" },
      minLength: { type: "string" },
      "x-client": { type: "string" },
    });
    expect(out.properties.actual).toEqual({ type: "string" });
  });

  it("still strips unsupported keywords from real schema nodes", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, format: "email", default: "x" },
      },
      required: ["name"],
    };

    const out = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(out.properties.name.minLength).toBeUndefined();
    expect(out.properties.name.format).toBeUndefined();
    expect(out.properties.name.default).toBeUndefined();
    expect(out.properties.name.type).toBe("string");
    expect(out.required).toEqual(["name"]);
  });

  it("still adds the placeholder property to empty object schema nodes", () => {
    const schema = {
      type: "object",
      properties: {
        empty: {},
      },
    };

    const out = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(out.properties.empty).toMatchObject({
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool",
        },
      },
      required: ["reason"],
    });
  });
});
