import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

const clean = (properties) => cleanJSONSchemaForAntigravity({ type: "object", properties }).properties;

describe("9router #4973 Gemini tool enum sanitization", () => {
  it("drops empty and null enum values and keeps the rest", () => {
    expect(clean({ id: { type: "string", enum: ["", "primary", null, "secondary"] } }).id)
      .toEqual({ type: "string", enum: ["primary", "secondary"] });
  });

  it.each([
    ["only empty values", { type: "string", enum: ["", null] }],
    ["an empty list", { type: "string", enum: [] }],
    ["a non-array value", { type: "string", enum: "primary" }],
    ["an empty const", { type: "string", const: "" }],
    ["a null const", { type: "string", const: null }],
  ])("removes the enum for %s", (_label, node) => {
    expect(clean({ id: node }).id).toEqual({ type: "string" });
  });

  it("gives an emptied untyped enum a string type", () => {
    expect(clean({ id: { enum: [""] } }).id).toEqual({ type: "string" });
  });

  it("adds no allowed-values hint for an empty numeric enum", () => {
    expect(clean({ id: { type: "integer", enum: [] } }).id).toEqual({ type: "integer" });
  });

  it("still converts a non-empty const and sanitizes nested array items", () => {
    const out = clean({
      status: { type: "string", const: "active" },
      rows: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: [""] } } } },
    });
    expect(out.status).toEqual({ type: "string", enum: ["active"] });
    expect(out.rows.items.properties.kind).toEqual({ type: "string" });
  });

  it("removes a non-array required flag from an object schema", () => {
    expect(clean({ filter: { type: "object", required: true, properties: { q: { type: "string" } } } }).filter)
      .toEqual({ type: "object", properties: { q: { type: "string" } } });
  });

  it("leaves parameters named enum, const and required alone", () => {
    const out = clean({ enum: { type: "string" }, const: { type: "string" }, required: { type: "string" } });
    expect(Object.keys(out)).toEqual(["enum", "const", "required"]);
  });
});
