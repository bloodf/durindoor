import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("DeepSeek structured output fallback", () => {
  it("downgrades a schema and preserves the caller's messages", () => {
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    const body = { messages: [{ role: "system", content: [{ type: "text", text: "Hi" }] }], response_format: { type: "json_schema", json_schema: { schema } } };
    const result = new DefaultExecutor("deepseek").applyJsonSchemaFallback(body);
    expect(result.response_format).toEqual({ type: "json_object" });
    expect(result.messages[0].content[1].text).toContain(JSON.stringify(schema, null, 2));
    expect(body.messages[0].content).toHaveLength(1);
  });
  it("handles a missing schema and leaves other formats and providers alone", () => {
    const executor = new DefaultExecutor("deepseek");
    const body = { messages: [{ role: "user", content: "hello" }], response_format: { type: "json_schema" } };
    const result = executor.applyJsonSchemaFallback(body);
    expect(result.response_format).toEqual({ type: "json_object" });
    expect(result.messages[0].content).toContain("valid JSON");
    const native = { response_format: { type: "json_object" } };
    expect(executor.applyJsonSchemaFallback(native)).toBe(native);
    expect(new DefaultExecutor("openai").applyJsonSchemaFallback(body)).toBe(body);
  });
});
