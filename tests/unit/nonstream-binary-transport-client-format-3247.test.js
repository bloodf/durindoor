import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

describe("#3247 non-streaming binary-transport replies", () => {
  it("projects a decoded Kiro completion into the Claude client format", () => {
    const response = {
      id: "chatcmpl-kiro",
      object: "chat.completion",
      model: "claude-haiku-4.5",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Hey there." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    };

    const projected = translateNonStreamingResponse(response, FORMATS.KIRO, FORMATS.CLAUDE);

    expect(projected).toMatchObject({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hey there." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 8 },
    });
    expect(projected.choices).toBeUndefined();
  });
});
