import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { handleBypassRequest } from "../../open-sse/utils/bypassHandler.js";

describe("handleBypassRequest", () => {
  it("ignores ordinary clients and ordinary Claude traffic", () => {
    const body = { messages: [{ role: "user", content: "count" }] };
    expect(handleBypassRequest(body, "demo", "other-client")).toBeNull();
    expect(handleBypassRequest({ messages: [{ role: "user", content: "hello" }] }, "demo", "claude-cli")).toBeNull();
  });

  it("returns a complete Claude JSON warmup response", async () => {
    const result = handleBypassRequest({
      model: "demo",
      system: "Claude Code",
      messages: [{ role: "user", content: "Warmup" }],
      stream: false,
    }, "demo", "claude-cli");
    const body = await result.response.json();

    expect(body).toMatchObject({
      type: "message",
      model: "demo",
      content: [{ type: "text", text: "CLI Command Execution: Clear Terminal" }],
      stop_reason: "end_turn",
    });
  });

  it("returns native Claude SSE for count without Chat [DONE]", async () => {
    const result = handleBypassRequest({
      model: "demo",
      system: "Claude Code",
      messages: [{ role: "user", content: "count" }],
      stream: true,
    }, "demo", "claude-cli");
    const text = await result.response.text();

    expect(text).toContain("event: message_start");
    expect(text).toContain("event: message_stop");
    expect(text).not.toContain("[DONE]");
  });

  it("preserves CC naming output through the shared response builder", async () => {
    const result = handleBypassRequest({
      model: "demo",
      system: "Return JSON containing isNewTopic",
      messages: [{ role: "user", content: "Investigate flaky terminal tests" }],
      stream: false,
    }, "demo", "claude-cli", true);
    const body = await result.response.json();
    const content = body.content[0].text;

    expect(JSON.parse(content)).toEqual({
      isNewTopic: true,
      title: "Investigate flaky terminal",
    });
  });
});
