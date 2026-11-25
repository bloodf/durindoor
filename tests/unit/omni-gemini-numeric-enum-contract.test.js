import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { claudeToGeminiRequest } from "../../open-sse/translator/request/claude-to-gemini.js";

// OmniRoute #760 (head 75d35602473b82d50f7cb988fc26e195442d49cd, merge
// 9fc3845d92ad1de3479415aeb362aa813449ff86) deleted integer/number enums for Gemini.
// Gemini Schema.enum is STRING-only, so the local contract keeps type + minimum/maximum
// and lifts the unsupported enum list into the description instead of deleting it.
const clean = (schema) => cleanJSONSchemaForAntigravity(structuredClone(schema));

describe("Gemini numeric enum contract", () => {
  it("keeps string enums as string enums", () => {
    const out = clean({ type: "object", properties: { mode: { type: "string", enum: ["fast", "slow"] } } });
    expect(out.properties.mode).toEqual({ type: "string", enum: ["fast", "slow"] });
  });

  it("keeps integer type and numeric constraints, drops only the unsupported enum list", () => {
    const out = clean({
      type: "object",
      properties: { level: { type: "integer", enum: [1, 2, 3], minimum: 1, maximum: 3, description: "CSS level" } }
    });
    const level = out.properties.level;
    expect(level.type).toBe("integer");
    expect(level.minimum).toBe(1);
    expect(level.maximum).toBe(3);
    expect(level).not.toHaveProperty("enum");
    expect(level.description).toBe("CSS level Allowed values: 1, 2, 3.");
  });

  it("keeps number and boolean types instead of stringifying values", () => {
    const out = clean({
      type: "object",
      properties: { ratio: { type: "number", enum: [0.5, 1.5] }, flag: { type: "boolean", enum: [true] } }
    });
    expect(out.properties.ratio).toEqual({ type: "number", description: "Allowed values: 0.5, 1.5." });
    expect(out.properties.flag).toEqual({ type: "boolean", description: "Allowed values: true." });
  });

  it("infers numeric type for typeless numeric const/enum instead of coercing to string", () => {
    const out = clean({ type: "object", properties: { fixed: { const: 5 }, pick: { enum: [1, 2] } } });
    expect(out.properties.fixed.type).toBe("integer");
    expect(out.properties.pick.type).toBe("integer");
    expect(out.properties.fixed).not.toHaveProperty("enum");
  });

  it("still stringifies mixed typeless enums as before", () => {
    const out = clean({ type: "object", properties: { mixed: { enum: [1, "a"] } } });
    expect(out.properties.mixed).toEqual({ type: "string", enum: ["1", "a"] });
  });

  it("handles nullable integer enums and nested array items", () => {
    const out = clean({
      type: "object",
      properties: {
        n: { type: ["integer", "null"], enum: [1, 2, null] },
        list: { type: "array", items: { type: "integer", enum: [7, 8] } }
      }
    });
    expect(out.properties.n).not.toHaveProperty("enum");
    expect(out.properties.n.description).toBe("Allowed values: 1, 2.");
    expect(out.properties.list.items).toEqual({ type: "integer", description: "Allowed values: 7, 8." });
  });

  it("is idempotent when cleaned twice (Gemini CLI path re-cleans)", () => {
    const once = clean({ type: "object", properties: { level: { type: "integer", enum: [1, 2] } } });
    expect(cleanJSONSchemaForAntigravity(structuredClone(once))).toEqual(once);
  });

  it("applies on the OpenAI -> Gemini and Claude -> Gemini tool routes", () => {
    const params = { type: "object", properties: { level: { type: "integer", enum: [1, 2], minimum: 1 } } };
    const fromOpenAI = openaiToGeminiRequest("gemini-2.5-pro", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "t", description: "d", parameters: structuredClone(params) } }]
    }, false);
    const fromClaude = claudeToGeminiRequest("gemini-2.5-pro", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "t", description: "d", input_schema: structuredClone(params) }]
    }, false);
    for (const req of [fromOpenAI, fromClaude]) {
      const level = req.tools[0].functionDeclarations[0].parameters.properties.level;
      expect(level.type).toBe("integer");
      expect(level.minimum).toBe(1);
      expect(level).not.toHaveProperty("enum");
      expect(level.description).toBe("Allowed values: 1, 2.");
    }
  });

  it("leaves string enums and unrelated schema untouched on the direct Claude route", () => {
    const schema = { type: "object", properties: { mode: { type: "string", enum: ["a", "b"] }, n: { type: "integer", minimum: 0, maximum: 9 } }, required: ["mode"] };
    const req = claudeToGeminiRequest("gemini-2.5-pro", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "t", input_schema: structuredClone(schema) }]
    }, false);
    expect(req.tools[0].functionDeclarations[0].parameters).toEqual(schema);
  });

  it("does not mutate the caller's original tool schema when cloned by routes", () => {
    const original = { type: "object", properties: { level: { type: "integer", enum: [1, 2] } } };
    openaiToGeminiRequest("gemini-2.5-pro", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "t", parameters: original } }]
    }, false);
    expect(original.properties.level.enum).toEqual([1, 2]);
    const claudeSchema = { type: "object", properties: { level: { type: "integer", enum: [1, 2] } } };
    claudeToGeminiRequest("gemini-2.5-pro", { messages: [{ role: "user", content: "hi" }], tools: [{ name: "t", input_schema: claudeSchema }] }, false);
    expect(claudeSchema.properties.level.enum).toEqual([1, 2]);
  });
});
