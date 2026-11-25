import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

const clean = (properties) => cleanJSONSchemaForAntigravity({ type: "object", properties }).properties;

describe("port(upstream) #4798 nested Gemini array schemas", () => {
  it("keeps a nested node that declares items without a type as a typed array", () => {
    const out = clean({
      tags: { items: { type: "string" } },
      matrix: { type: "array", items: { items: { items: {} } } },
    });

    expect(out.tags).toEqual({ type: "array", items: { type: "string" } });
    expect(out.matrix).toEqual({ type: "array", items: { type: "array", items: { type: "array", items: { type: "string" } } } });
  });

  it("does not read parameters named items as array keywords", () => {
    const out = clean({ query: { type: "object", properties: { items: { type: "string" } } } });

    expect(out.query).toEqual({ type: "object", properties: { items: { type: "string" } } });
  });

  it("types empty, tuple and annotation-only items below another array", () => {
    const out = clean({
      empty: { type: "array", items: { type: "array", items: {} } },
      missing: { type: "array", items: { type: "array" } },
      tuple: { type: "array", items: [{ type: "string" }, { type: "string" }] },
      stripped: { type: "array", items: { type: "array", items: { title: "Condition", default: [] } } },
    });

    for (const node of [out.empty, out.missing, out.stripped]) expect(node.items.items.type).toBe("string");
    expect(Array.isArray(out.tuple.items)).toBe(false);
    expect(out.tuple.items.type).toBe("string");
  });
});
