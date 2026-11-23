import { describe, expect, it, vi } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

const compile = (schema) => cleanJSONSchemaForAntigravity(schema, { structuredOutput: true, preserveNullable: true });

describe("structured output schema compilation", () => {
  it("resolves local JSON pointers and preserves reference siblings", () => {
    const result = compile({ type: "object", $defs: { "a/b": { type: "string" } }, properties: { name: { $ref: "#/$defs/a~1b", description: "Name" } } });
    expect(result.properties.name).toEqual({ type: "string", description: "Name" });
  });

  it("preserves schema-keyword property names", () => {
    const result = compile({ type: "object", properties: { $ref: { type: "string" }, $defs: { type: "number" } } });
    expect(result.properties).toEqual({ $ref: { type: "string" }, $defs: { type: "number" } });
  });

  it.each([
    null,
    [],
    { $ref: "#/$defs/missing" },
    { $ref: "https://example.com/schema" },
    { $defs: { loop: { $ref: "#/$defs/loop" } }, $ref: "#/$defs/loop" },
    { $ref: "#/bad~2escape" },
  ])("rejects invalid or recursive references", (schema) => {
    expect(() => compile(schema)).toThrowError(expect.objectContaining({ statusCode: 400, localSchemaError: true }));
  });

  it("rejects an invalid client schema during request translation", () => {
    const body = { messages: [{ role: "user", content: "hello" }], response_format: { type: "json_schema", json_schema: { schema: { $ref: "#/$defs/missing" } } } };
    expect(() => openaiToGeminiRequest("gemini-3-flash", body, false)).toThrowError(expect.objectContaining({ statusCode: 400, localSchemaError: true }));
  });

  it("rejects expansion beyond the node budget", () => {
    const properties = Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [`p${i}`, { type: "string" }]));
    expect(() => compile({ type: "object", properties })).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });

  it("returns local schema errors without trying the next combo route", async () => {
    const response = Response.json({ error: { message: "invalid schema" } }, { status: 400 });
    response[Symbol.for("durindoor.localSchemaError")] = true;
    const handleSingleModel = vi.fn(async () => response);
    const result = await handleComboChat({ body: { messages: [{ role: "user", content: "hello" }] }, models: ["a/model", "b/model"], comboName: "schema-error-4667", autoSwitch: false, log: { info() {}, warn() {}, debug() {}, error() {} }, handleSingleModel });
    expect(result.status).toBe(400);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
  });
});
