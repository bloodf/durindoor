import { describe, expect, it } from "vitest";
import { OpenCodeExecutor, OPENCODE_UA } from "../../open-sse/executors/opencode.js";

describe("OpenCode free client compatibility (#5776)", () => {
  const executor = new OpenCodeExecutor();

  it("uses API-family endpoints without changing model routing", () => {
    expect(executor.buildUrl("big-pickle")).toBe("https://opencode.ai/inference/openai/v1/chat/completions");
    expect(executor.buildUrl("muse-spark-1.3-contributor-free")).toBe("https://opencode.ai/inference/openai/v1/responses");
    expect(executor.buildUrl("union-alpha")).toBe("https://opencode.ai/inference/anthropic/v1/messages");
  });

  it("updates the public version while preserving caller-supplied versions", () => {
    expect(OPENCODE_UA).toBe("opencode/latest/2.4.1/cli");
    expect(executor.buildHeaders({}, true, { clientHeaders: { "user-agent": "opencode/latest/2.1.0/cli" } })["User-Agent"]).toBe("opencode/latest/2.1.0/cli");
  });

  it("retains reasoning and caller tool data on the chat route", () => {
    const body = { messages: [{ role: "user", content: "hello" }], reasoning_effort: "high", tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }] };
    const result = executor.transformRequest("big-pickle", body, true, {});
    expect(result.reasoning_effort).toBe("high");
    expect(result.tools.find((tool) => tool.function?.name === "lookup")).toEqual(body.tools.find((tool) => tool.function?.name === "lookup"));
    expect(result.stream).toBe(true);
  });

  it("retains a caller-provided Responses cache key", () => {
    const result = executor.transformRequest("muse-spark-1.3-contributor-free", { input: [], prompt_cache_key: "caller-key" }, true, { _opencodeSession: "other" });
    expect(result.prompt_cache_key).toBe("caller-key");
  });
});
