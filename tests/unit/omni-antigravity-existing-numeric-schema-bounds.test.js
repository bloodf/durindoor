import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

function route(parameters) {
  const body = { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }], tools: [{ functionDeclarations: [{ name: "lookup", parameters }] }] } };
  return new AntigravityExecutor().transformRequest("gemini-3.1-pro-high", body, true, { projectId: "p", connectionId: "c" }).request.tools[0].functionDeclarations[0].parameters;
}

describe("Antigravity native tool schema numeric bounds", () => {
  it("normalizes valid surviving bounds through the executor while preserving names, references and pruning", () => {
    const schema = {
      type: "object", minProperties: "1", maxProperties: "5", $defs: { limit: { type: "number", minimum: "-1.5", maximum: "2e2", minLength: "4" } },
      properties: {
        minimum: { $ref: "#/$defs/limit" },
        maximum: { type: "array", items: { type: "number", minimum: "0", maximum: 7, properties: { stray: { type: "string" } } } },
        minProperties: { type: "object", minProperties: "-1", maxProperties: "1.5", properties: { maxProperties: { type: "string" } } },
        maxProperties: { type: "number", minimum: " ", maximum: "Infinity", description: "12" },
        unknown: { type: "number", minimum: "nope", maximum: "1e999", custom: "3" }
      }
    };
    const out = route(schema);
    expect(out.minProperties).toBe(1);
    expect(out.maxProperties).toBe(5);
    expect(out.properties.minimum).toMatchObject({ minimum: -1.5, maximum: 200 });
    expect(out.properties.minimum).not.toHaveProperty("minLength");
    expect(out.properties.maximum.items).toMatchObject({ minimum: 0, maximum: 7 });
    expect(out.properties.maximum.items).not.toHaveProperty("properties");
    expect(out.properties.minProperties).toMatchObject({ minProperties: "-1", maxProperties: "1.5", properties: { maxProperties: { type: "string" } } });
    expect(out.properties.maxProperties).toMatchObject({ minimum: " ", maximum: "Infinity", description: "12" });
    expect(out.properties.unknown).toMatchObject({ minimum: "nope", maximum: "1e999", custom: "3" });
    expect(schema.properties.minimum.$ref).toBe("#/$defs/limit");
  });

  it("leaves the shared cleaner's generic behavior unchanged", () => {
    expect(cleanJSONSchemaForAntigravity({ type: "number", minimum: "2" }).minimum).toBe("2");
  });
});
