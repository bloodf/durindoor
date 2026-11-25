import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { handleBypassRequest } from "../../open-sse/utils/bypassHandler.js";

const warmup = (extra) => ({
  model: "demo",
  system: "Claude Code",
  messages: [{ role: "user", content: "Warmup" }],
  ...extra,
});

describe("9router #4427 - bypass replies stream only on an explicit stream: true", () => {
  it.each([
    ["omitted", {}],
    ["null", { stream: null }],
    ["false", { stream: false }],
    ["the string \"true\"", { stream: "true" }],
  ])("answers JSON when stream is %s", async (_label, extra) => {
    const result = handleBypassRequest(warmup(extra), "demo", "claude-cli");

    expect(result.response.headers.get("Content-Type")).toContain("application/json");
    expect(await result.response.json()).toMatchObject({ type: "message", stop_reason: "end_turn" });
  });

  it("answers SSE when stream is true", async () => {
    const result = handleBypassRequest(warmup({ stream: true }), "demo", "claude-cli");

    expect(result.response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await result.response.text()).toContain("event: message_stop");
  });

  it("applies the same default to the naming bypass", async () => {
    const result = handleBypassRequest({
      model: "demo",
      system: "Return JSON containing isNewTopic",
      messages: [{ role: "user", content: "Investigate flaky terminal tests" }],
    }, "demo", "claude-cli", true);

    expect(result.response.headers.get("Content-Type")).toContain("application/json");
  });
});
