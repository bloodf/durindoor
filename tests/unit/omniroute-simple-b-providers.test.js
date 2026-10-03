import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
describe("OmniRoute simple/default provider batch B", () => {

  it("forces Galadriel OpenAI payloads to non-streaming and drops stream_options", () => {
    const executor = new DefaultExecutor("galadriel");
    const body = executor.transformRequest(
      "gpt-4o",
      { model: "gpt-4o", messages: [{ role: "user", content: "ping" }], stream: true, stream_options: { include_usage: true } },
      false,
      { apiKey: "test-key" },
    );

    expect(body.model).toBe("gpt-4o");
    expect(body.stream).toBe(false);
    // Upstream 400s if stream_options is sent alongside a forced stream:false —
    // it's only meaningful with stream:true (controls the final usage chunk).
    expect(body.stream_options).toBeUndefined();
  });


});
