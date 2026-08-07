import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChatCore: vi.fn(),
  handlePonytailCommands: vi.fn(),
  convertResponsesApiFormat: vi.fn(),
  recordTokenSaverEvent: vi.fn(),
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
vi.mock("@/lib/usageDb.js", () => ({
  recordTokenSaverEvent: mocks.recordTokenSaverEvent,
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
    // No telemetry event emitted → nothing persisted.
    expect(mocks.recordTokenSaverEvent).not.toHaveBeenCalled();
  });

  it("preserves native Responses input token details when buffering SSE", async () => {
    const converted = { model: "demo", messages: [{ role: "user", content: "hello" }] };
    const usage = {
      input_tokens: 100,
      output_tokens: 5,
      total_tokens: 105,
      input_tokens_details: { cached_tokens: 70, cache_creation_tokens: 10 },
    };
    const sse = [
      `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: "resp_1", status: "in_progress" } })}`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", status: "completed", usage } })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    mocks.handlePonytailCommands.mockResolvedValue(null);
    mocks.convertResponsesApiFormat.mockReturnValue(converted);
    mocks.handleChatCore.mockResolvedValue({
      success: true,
      response: new Response(sse, { headers: { "Content-Type": "text/event-stream" } }),
    });

    const result = await handleResponsesCore({
      body: { model: "demo", input: "hello", stream: false },
      modelInfo: { provider: "demo", model: "demo" },
      credentials: {},
    });

    expect(JSON.parse(await result.response.text()).usage).toEqual(usage);
  });

  it("persists the captured token-saver event once after chatCore returns (port of 9router #2562)", async () => {
    const converted = { model: "demo", messages: [{ role: "user", content: "hello" }] };
    const upstream = {
      success: true,
      response: new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }),
    };
    const event = { requestsObserved: 1, rtk: { bytesSaved: 12 }, headroom: { state: "compressed", tokensSaved: 5 } };
    mocks.handlePonytailCommands.mockResolvedValue(null);
    mocks.convertResponsesApiFormat.mockReturnValue(converted);
    mocks.handleChatCore.mockImplementation(async (options) => {
      options.onTokenSaverEvent(event);
      return upstream;
    });
    mocks.recordTokenSaverEvent.mockResolvedValue(undefined);

    const result = await handleResponsesCore({
      body: { model: "demo", input: "hello" },
      modelInfo: { provider: "demo", model: "demo" },
      credentials: { accessToken: "token" },
    });

    expect(result).toBe(upstream);
    expect(mocks.recordTokenSaverEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordTokenSaverEvent).toHaveBeenCalledWith(event);
  });

  it("survives a token-saver persistence failure (fail-open)", async () => {
    const converted = { model: "demo", messages: [] };
    const upstream = {
      success: true,
      response: new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }),
    };
    mocks.handlePonytailCommands.mockResolvedValue(null);
    mocks.convertResponsesApiFormat.mockReturnValue(converted);
    mocks.handleChatCore.mockImplementation(async (options) => {
      options.onTokenSaverEvent({ requestsObserved: 1 });
      return upstream;
    });
    mocks.recordTokenSaverEvent.mockRejectedValue(new Error("db down"));

    const result = await handleResponsesCore({
      body: { model: "demo", input: "hello" },
      modelInfo: { provider: "demo", model: "demo" },
      credentials: {},
    });

    expect(result).toBe(upstream);
  });
});
