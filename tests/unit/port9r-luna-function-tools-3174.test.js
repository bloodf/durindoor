import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Luna function tools", () => {
  const request = (tools = [{ type: "function", function: { name: "lookup" } }]) => ({
    model: "gpt-5.6-luna", messages: [{ role: "user", content: "hello" }], tools, reasoning_effort: "high",
  });

  it("disables reasoning for first-party Chat function tools", () => {
    const result = new DefaultExecutor("openai").transformRequest("gpt-5.6-luna", request(), false);
    expect(result.reasoning_effort).toBe("none");
  });

  it("preserves reasoning for other models, providers, tools and Responses requests", () => {
    const cases = [
      ["openai", "gpt-4o", request(), null],
      ["openrouter", "gpt-5.6-luna", request(), null],
      ["openai", "gpt-5.6-luna", request([{ type: "web_search" }]), null],
      ["openai", "gpt-5.6-luna", request(), { sourceFormat: FORMATS.OPENAI_RESPONSES }],
    ];
    for (const [provider, model, body, context] of cases) {
      expect(new DefaultExecutor(provider).transformRequest(model, body, false, null, context).reasoning_effort).toBe("high");
    }
  });
});
