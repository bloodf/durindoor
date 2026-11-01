import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handleChatCore: vi.fn() }));
vi.mock("../../open-sse/handlers/chatCore.js", () => mocks);
vi.mock("@/lib/usageDb.js", () => ({ recordTokenSaverEvent: vi.fn() }));
vi.mock("../../open-sse/utils/tokenSaverBridge.js", () => ({
  handlePonytailCommands: vi.fn(async () => null), DEFAULT_PONYTAIL_HELP: "help",
}));
const { handleResponsesCore } = await import("../../open-sse/handlers/responsesHandler.js");

describe("Responses worker handler file-reference validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleChatCore.mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }),
    });
  });
  const scopedImage = { type: "input_image", file_id: "file-scoped" };
  const inputs = [
    [{ role: "user", content: [scopedImage] }],
    [{ type: "function_call", call_id: "c1", name: "capture", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: [scopedImage] }],
  ];
  it.each([false, true])("returns HTTP 400 before chat dispatch (stream=%s)", async (stream) => {
    for (const input of inputs) {
      const result = await handleResponsesCore({
        body: { model: "test", stream, input: structuredClone(input) },
        modelInfo: { provider: "groq", model: "test" }, credentials: {},
      });
      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.response.status).toBe(400);
      expect((await result.response.json()).error.message).toContain("file_id is not supported");
      expect(mocks.handleChatCore).not.toHaveBeenCalled();
    }
  });

  it.each([false, true])("preserves existing tool-output serialization and URL precedence (stream=%s)", async (stream) => {
    const response = new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    mocks.handleChatCore.mockResolvedValue({ success: true, response });
    for (const output of ["plain tool output", [{ type: "input_text", text: "captured" }],
      [{ type: "input_image", image_url: "https://example.com/image.png", file_id: "file-scoped" }]]) {
      const result = await handleResponsesCore({
        body: { model: "test", stream, input: [
          { type: "function_call", call_id: "c1", name: "capture", arguments: "{}" },
          { type: "function_call_output", call_id: "c1", output },
        ] }, modelInfo: { provider: "groq", model: "test" }, credentials: {},
      });
      expect(result.response).toBe(response);
      const dispatched = mocks.handleChatCore.mock.lastCall[0].body;
      expect(dispatched.messages.find((message) => message.role === "tool").content)
        .toBe(Array.isArray(output) ? JSON.stringify(output) : output);
    }
  });
});
