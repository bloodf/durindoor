import { describe, expect, it } from "vitest";
import { handleBypassRequest } from "../../open-sse/utils/bypassHandler.js";

describe("upstream #4534 - bypass replies default to JSON", () => {
  it.each([undefined, null, false, true])("streams only for an explicit stream=true (%s)", async (stream) => {
    const body = { model: "test-model", messages: [{ role: "user", content: "count" }] };
    if (stream !== undefined) body.stream = stream;

    const result = handleBypassRequest(body, "test-model", "claude-cli");

    expect(result.response.headers.get("content-type")).toBe(stream === true ? "text/event-stream" : "application/json");
    if (stream === true) expect(await result.response.text()).toContain("data:");
    else expect((await result.response.json()).object).toBe("chat.completion");
  });
});
