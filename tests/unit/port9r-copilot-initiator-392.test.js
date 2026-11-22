import { describe, expect, it, vi } from "vitest";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";

describe("Copilot initiator", () => {
  const executor = new GithubExecutor();
  const credentials = { accessToken: "test" };

  it("marks a tool continuation as an agent request", () => {
    expect(executor.buildHeaders(credentials, true, { copilotMessages: [{ role: "user" }, { role: "tool" }] })["X-Initiator"]).toBe("agent");
  });

  it("marks a new user turn as a user request", () => {
    expect(executor.buildHeaders(credentials, true, { copilotMessages: [{ role: "assistant" }, { role: "user" }] })["X-Initiator"]).toBe("user");
  });

  it("carries the messages into the chat transport context", async () => {
    const dispatch = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({ response: new Response("{}") });
    try {
      await executor.execute({ model: "gemini-test", body: { messages: [{ role: "tool", content: "done" }] }, credentials, log: { debug: vi.fn() } });
      const context = dispatch.mock.calls[0][0].requestContext;
      expect(executor.buildHeaders(credentials, true, context)["X-Initiator"]).toBe("agent");
    } finally {
      dispatch.mockRestore();
    }
  });
});
