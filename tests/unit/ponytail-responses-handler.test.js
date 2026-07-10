import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChatCore: vi.fn(),
  handlePonytailCommands: vi.fn(),
  convertResponsesApiFormat: vi.fn(),
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));
vi.mock("../../open-sse/utils/tokenSaverBridge.js", () => ({
  DEFAULT_PONYTAIL_HELP: "HELP",
  handlePonytailCommands: mocks.handlePonytailCommands,
}));
vi.mock("../../open-sse/translator/formats/responsesApi.js", () => ({
  convertResponsesApiFormat: mocks.convertResponsesApiFormat,
}));

const { handleResponsesCore } = await import("../../open-sse/handlers/responsesHandler.js");

describe("handleResponsesCore Ponytail boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an already-native command response before Chat conversion", async () => {
    const synthetic = {
      success: true,
      response: new Response("native", { headers: { "Content-Type": "text/event-stream" } }),
    };
    mocks.handlePonytailCommands.mockResolvedValue(synthetic);

    const result = await handleResponsesCore({
      body: { model: "demo", input: "/ponytail-help", stream: true },
      modelInfo: { provider: "demo", model: "demo" },
      credentials: {},
    });

    expect(result).toBe(synthetic);
    expect(mocks.handlePonytailCommands).toHaveBeenCalledWith(
      expect.objectContaining({ input: "/ponytail-help" }),
      "demo",
      expect.objectContaining({ sourceFormatOverride: "openai-responses", streamOverride: true }),
    );
    expect(mocks.convertResponsesApiFormat).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("lets ordinary requests reach chatCore once without a second command intercept", async () => {
    const converted = { model: "demo", messages: [{ role: "user", content: "hello" }] };
    const upstream = {
      success: true,
      response: new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }),
    };
    mocks.handlePonytailCommands.mockResolvedValue(null);
    mocks.convertResponsesApiFormat.mockReturnValue(converted);
    mocks.handleChatCore.mockResolvedValue(upstream);

    const result = await handleResponsesCore({
      body: { model: "demo", input: "hello" },
      modelInfo: { provider: "demo", model: "demo" },
      credentials: { accessToken: "token" },
    });

    expect(result).toBe(upstream);
    expect(converted.stream).toBe(false);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    expect(mocks.handleChatCore).toHaveBeenCalledWith(expect.objectContaining({
      body: converted,
      sourceFormatOverride: "openai-responses",
      skipPonytailCommands: true,
    }));
  });
});
