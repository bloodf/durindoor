import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const executor = new CodexExecutor();
const model = "gpt-5.3-codex";
const makeBody = () => ({
  model, input: [{ role: "system", content: "Follow the policy" }, { role: "user", content: "Hello" }],
  instructions: "Existing instructions", tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }],
  prompt_cache_key: "cache-key", parallel_tool_calls: true, background: false, truncation: "auto",
  max_output_tokens: 1000, max_completion_tokens: 1000, store: true,
});

describe("Codex Responses sanitization (#873)", () => {
  it.each([{}, { translatedToCodex: true }])("removes unsupported defaults on standard requests (%j)", (context) => {
    const result = executor.transformRequest(model, makeBody(), true, {}, context);
    for (const key of ["parallel_tool_calls", "background", "truncation", "max_output_tokens", "max_completion_tokens"]) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result.store).toBe(false);
    expect(result.prompt_cache_key).toBe("cache-key");
    expect(result.tools[0].name).toBe("lookup");
    expect(result.input.some((item) => item.role === "developer")).toBe(true);
    expect(result.instructions).toBe(context.translatedToCodex ? "You are a helpful assistant." : "Existing instructions");
  });

  it("preserves Lite and compact tool-call contracts", () => {
    const lite = { clientHeaders: { "x-openai-internal-codex-responses-lite": "true" } };
    expect(executor.transformRequest(model, makeBody(), true, {}, lite).parallel_tool_calls).toBe(false);
    const compact = executor.transformRequest(model, makeBody(), true, {}, { compact: true });
    expect(compact.parallel_tool_calls).toBe(true);
    expect(compact.prompt_cache_key).toBe("cache-key");
    expect(compact.input.some((item) => item.role === "developer")).toBe(true);
  });
});
