import { describe, expect, it } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";
import { normalizeCodeBuddyResponse } from "../../open-sse/executors/codebuddy-protocol.js";

describe("CodeBuddy protocol normalization", () => {
  it.each([new CodeBuddyExecutor(), new CodeBuddyIntlExecutor()])("normalizes opt-out and empty tools", (executor) => {
    const body = executor.transformRequest("model", { messages: [], tools: [], reasoning_effort: " OFF ", reasoning_summary: "auto", custom: 1 }, false, {});
    expect(body).toMatchObject({ stream: true, custom: 1 });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("reasoning_summary");
    const enabled = executor.transformRequest("model", { messages: [], reasoning_effort: "high", reasoning_summary: "detailed" }, false, {});
    expect(enabled.reasoning_summary).toBe("detailed");
  });
  it("cleans SSE chunks without changing other data or retaining content length", async () => {
    const input = 'data: {"choices":[{"delta":{"function_call":{"name":"","arguments":""}},"finish_reason":""}]}\n\ndata: [DONE]\n\n';
    const response = new Response(input, { headers: { "content-type": "text/event-stream", "content-length": "1" } });
    const result = normalizeCodeBuddyResponse({ response, marker: 7 });
    expect(result.marker).toBe(7);
    expect(result.response.headers.has("content-length")).toBe(false);
    expect(await result.response.text()).toBe('data: {"choices":[{"delta":{},"finish_reason":null}]}\n\ndata: [DONE]\n\n');
  });
});
