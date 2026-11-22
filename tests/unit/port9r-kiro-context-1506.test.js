import { describe, expect, it } from "vitest";
import { resolveKiroModel } from "../../open-sse/config/kiroConstants.js";

describe("Kiro context suffix", () => {
  it("rejects the Anthropic-only context suffix before resolving the upstream model", () => {
    expect(() => resolveKiroModel("claude-opus-4.7-thinking-agentic[1M]")).toThrow("Kiro does not support the [1m] context suffix");
  });

  it("continues to resolve supported model suffixes", () => {
    expect(resolveKiroModel("claude-sonnet-4.5-thinking-agentic")).toMatchObject({ upstream: "claude-sonnet-4.5", thinking: true, agentic: true });
  });
});
