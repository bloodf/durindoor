import { describe, expect, it } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("Anthropic header normalization", () => {
  it("preserves a configured version and merges beta variants in the base executor", () => {
    const executor = new BaseExecutor("anthropic-compatible-test", { headers: {
      "Anthropic-Version": "2024-01-01", "Anthropic-Beta": "one, two", "anthropic-beta": "two, three", "x-provider": "kept",
    } });
    const headers = executor.buildHeaders({ apiKey: "key" }, false);
    expect(new Headers(headers).get("anthropic-version")).toBe("2024-01-01");
    expect(new Headers(headers).get("anthropic-beta")).toBe("one,two,three");
    expect(headers["x-provider"]).toBe("kept");
    expect(headers["x-api-key"]).toBe("key");
  });

  it("deduplicates case variants in the default executor including without credentials", () => {
    const executor = new DefaultExecutor("openai");
    executor.config = { headers: { "Anthropic-Version": "2023-06-01", "anthropic-version": "2023-06-01", "Anthropic-Beta": "one,two", "anthropic-beta": "two,three" } };
    for (const credentials of [{}, { apiKey: "key" }]) {
      const headers = new Headers(executor.buildHeaders(credentials, false));
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(headers.get("anthropic-beta")).toBe("one,two,three");
    }
  });
});
