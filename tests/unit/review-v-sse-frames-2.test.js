import { describe, expect, it } from "vitest";
import { formatClaudeSseError } from "../../open-sse/utils/sseFrames.js";
import { buildStreamErrorBytes } from "../../open-sse/utils/streamHelpers.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Claude SSE error frames", () => {
  it("writes the standard event and JSON payload", () => {
    expect(formatClaudeSseError({ type: "api_error", message: "failed" }))
      .toBe('event: error\ndata: {"type":"error","error":{"type":"api_error","message":"failed"}}\n\n');
  });
  it("uses the same frame for an aborted Claude stream", () => {
    const frame = new TextDecoder().decode(buildStreamErrorBytes(500, "failed", FORMATS.CLAUDE));
    const payload = JSON.parse(frame.split("data: ")[1]);
    expect(frame).toBe(formatClaudeSseError(payload.error));
  });
});
