import { describe, expect, it } from "vitest";
import { GeminiCLIExecutor } from "../../open-sse/executors/gemini-cli.js";
import { GrokCliExecutor, _resetGrokCliTurnStore } from "../../open-sse/executors/grok-cli.js";
import { OpenCodeZenExecutor } from "../../open-sse/executors/opencode-zen.js";

describe("executor request state isolation (#3169)", () => {
  it("uses explicit Gemini model after interleaved transformations", () => {
    const executor = new GeminiCLIExecutor();
    const credentials = { accessToken: "token" };

    executor.transformRequest("gemini-2.0-flash", { prompt: "first" }, false, credentials);
    executor.transformRequest("gemini-1.5-pro", { prompt: "second" }, false, credentials);

    expect(executor.buildHeaders(credentials, false, null, "gemini-2.0-flash")["User-Agent"])
      .toContain("gemini-2.0-flash");
    expect(executor.buildHeaders(credentials, false, null, "gemini-1.5-pro")["User-Agent"])
      .toContain("gemini-1.5-pro");
  });


  it("uses explicit OpenCode Zen model after interleaved URL selection", () => {
    const executor = new OpenCodeZenExecutor();
    const credentials = { apiKey: "token" };

    executor.buildUrl("claude-sonnet-4");
    executor.buildUrl("gpt-5");

    expect(executor.buildHeaders(credentials, false, null, "claude-sonnet-4")["x-api-key"])
      .toBe("token");
    expect(executor.buildHeaders(credentials, false, null, "gpt-5").Authorization)
      .toBe("Bearer token");
  });

  it("keeps Grok request IDs isolated across interleaved transforms", () => {
    _resetGrokCliTurnStore();
    const executor = new GrokCliExecutor();
    const firstCredentials = { accessToken: "token", connectionId: "first-connection", rawHeaders: { "x-session-id": "session-1" } };
    const secondCredentials = { accessToken: "token", connectionId: "second-connection", rawHeaders: { "x-session-id": "session-2" } };
    const firstContext = {};
    const secondContext = {};

    executor.transformRequest("grok-build", {
      input: [{ type: "message", role: "user", content: "first" }],
    }, true, firstCredentials, firstContext);
    executor.transformRequest("grok-4.5", {
      input: [
        { type: "message", role: "user", content: "second" },
        { type: "message", role: "user", content: "again" },
      ],
    }, true, secondCredentials, secondContext);

    const firstHeaders = executor.buildHeaders(firstCredentials, true, firstContext, "grok-build");
    const secondHeaders = executor.buildHeaders(secondCredentials, true, secondContext, "grok-4.5");
    expect(firstHeaders["x-grok-conv-id"]).toBe(firstContext.grokCliSessionId);
    expect(firstContext.grokCliSessionId).not.toBe(secondContext.grokCliSessionId);
    expect(firstHeaders["x-grok-req-id"]).toBe(firstContext.grokCliRequestId);
    expect(firstHeaders["x-grok-turn-idx"]).toBe("1");
    expect(firstHeaders["x-grok-model-override"]).toBe("grok-build");
    expect(secondHeaders["x-grok-conv-id"]).toBe(secondContext.grokCliSessionId);
    expect(secondHeaders["x-grok-req-id"]).toBe(secondContext.grokCliRequestId);
    expect(secondHeaders["x-grok-turn-idx"]).toBe("2");
    expect(secondHeaders["x-grok-model-override"]).toBe("grok-4.5");
  });
});
