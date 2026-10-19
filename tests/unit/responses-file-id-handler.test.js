import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handleChatCore: vi.fn() }));
vi.mock("../../open-sse/handlers/chatCore.js", () => mocks);
vi.mock("@/lib/usageDb.js", () => ({ recordTokenSaverEvent: vi.fn() }));
vi.mock("../../open-sse/utils/tokenSaverBridge.js", () => ({
  handlePonytailCommands: vi.fn(async () => null), DEFAULT_PONYTAIL_HELP: "help",
}));
const { handleResponsesCore } = await import("../../open-sse/handlers/responsesHandler.js");

describe("Responses worker handler file-reference validation", () => {
  it.each([false, true])("returns HTTP 400 before chat dispatch (stream=%s)", async (stream) => {
    const result = await handleResponsesCore({
      body: { model: "test", stream, input: [{ role: "user", content: [
        { type: "input_image", file_id: "file-scoped" },
      ] }] },
      modelInfo: { provider: "groq", model: "test" }, credentials: {},
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.response.status).toBe(400);
    expect((await result.response.json()).error.message).toContain("file_id is not supported");
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
});
