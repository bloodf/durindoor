import { describe, expect, it } from "vitest";
import { stripCodexUnsupportedPatterns } from "../../open-sse/utils/codexToolSchema.js";

describe("9router #4976 Codex numeric tool schema values", () => {
  it("converts string-encoded numeric keywords at every schema depth", () => {
    const schema = {
      type: "object",
      minProperties: "1",
      maxProperties: "4",
      properties: {
        list: { type: "array", minItems: "1", maxItems: "10", minContains: "1", maxContains: "2", items: { type: "string", minLength: "2", maxLength: "8" } },
        ratio: { anyOf: [{ type: "number", minimum: "0.5", maximum: "1e2", exclusiveMinimum: "0", exclusiveMaximum: "101", multipleOf: "0.5", default: "1.5" }] },
        count: { type: "integer", default: "3" },
      },
    };
    const out = stripCodexUnsupportedPatterns(schema);

    expect(out.minProperties).toBe(1);
    expect(out.maxProperties).toBe(4);
    expect(out.properties.list).toMatchObject({ minItems: 1, maxItems: 10, minContains: 1, maxContains: 2, items: { minLength: 2, maxLength: 8 } });
    expect(out.properties.ratio.anyOf[0]).toEqual({ type: "number", minimum: 0.5, maximum: 100, exclusiveMinimum: 0, exclusiveMaximum: 101, multipleOf: 0.5, default: 1.5 });
    expect(out.properties.count.default).toBe(3);
    expect(schema.properties.count.default).toBe("3");
  });

  it("keeps values that are not safe numbers, string defaults and property names", () => {
    const schema = {
      type: "object",
      properties: {
        minimum: { type: "string", default: "1" },
        a: { type: "integer", default: "1.5", minLength: "", maxLength: "ten" },
        b: { type: "integer", default: "9007199254740993", maximum: "Infinity" },
        c: { type: "object", default: { minimum: "1" }, examples: [{ maxItems: "2" }] },
      },
    };
    expect(stripCodexUnsupportedPatterns(schema)).toBe(schema);
  });
});
