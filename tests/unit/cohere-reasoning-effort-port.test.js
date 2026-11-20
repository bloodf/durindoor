import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("Cohere reasoning effort compatibility", () => {
  it.each(["none", "minimal", "low", "medium", "high", "xhigh", "max"])("maps %s to high", (effort) => {
    const body = { model: "command-a", messages: [], reasoning_effort: effort };
    expect(new DefaultExecutor("cohere").transformRequest(body.model, body, false).reasoning_effort).toBe("high");
  });

  it("leaves omitted effort and other providers alone", () => {
    expect(new DefaultExecutor("cohere").transformRequest("command-a", { messages: [] }, false).reasoning_effort).toBeUndefined();
    expect(new DefaultExecutor("opencode").transformRequest("test", { messages: [], reasoning_effort: "low" }, false).reasoning_effort).toBe("low");
  });
});
