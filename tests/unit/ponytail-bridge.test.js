import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/bypassResponse.js", () => ({
  createNonStreamingResponse: vi.fn((sourceFormat, model, text) => ({
    kind: "json",
    sourceFormat,
    model,
    text,
  })),
  createStreamingResponse: vi.fn((sourceFormat, model, text) => ({
    kind: "sse",
    sourceFormat,
    model,
    text,
  })),
}));

const detectFormatMock = vi.fn(() => "openai");
vi.mock("../../open-sse/services/provider.js", () => ({
  detectFormat: (...args) => detectFormatMock(...args),
}));

const { handlePonytailCommands } = await import("../../open-sse/utils/tokenSaverBridge.js");
const { createNonStreamingResponse, createStreamingResponse } = await import("../../open-sse/utils/bypassResponse.js");

describe("handlePonytailCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectFormatMock.mockReturnValue("openai");
  });

  it("uses caller-provided sourceFormatOverride and streamOverride", async () => {
    const result = await handlePonytailCommands(
      { messages: [{ role: "user", content: "/ponytail-help" }], stream: true },
      "demo-model",
      {
        helpText: "HELP",
        sourceFormatOverride: "claude",
        streamOverride: false,
      },
    );

    expect(createNonStreamingResponse).toHaveBeenCalledWith("claude", "demo-model", "HELP");
    expect(createStreamingResponse).not.toHaveBeenCalled();
    expect(result.kind).toBe("json");
  });

  it("preserves explicit stream:false when no override is given", async () => {
    const result = await handlePonytailCommands(
      { messages: [{ role: "user", content: "/ponytail-help" }], stream: false },
      "demo-model",
      { helpText: "HELP" },
    );

    expect(createNonStreamingResponse).toHaveBeenCalledWith("openai", "demo-model", "HELP");
    expect(createStreamingResponse).not.toHaveBeenCalled();
    expect(result.kind).toBe("json");
  });

  it("detects commands inside Responses API input", async () => {
    detectFormatMock.mockReturnValue("openai");

    const result = await handlePonytailCommands(
      { input: [{ role: "user", content: "/ponytail-help" }], stream: false },
      "demo-model",
      { helpText: "HELP" },
    );

    expect(createNonStreamingResponse).toHaveBeenCalledWith("openai", "demo-model", "HELP");
    expect(result.kind).toBe("json");
  });

  it("detects commands from plain Responses input string", async () => {
    detectFormatMock.mockReturnValue("openai");

    const result = await handlePonytailCommands(
      { input: "/ponytail-help", stream: false },
      "demo-model",
      { helpText: "HELP" },
    );

    expect(createNonStreamingResponse).toHaveBeenCalledWith("openai", "demo-model", "HELP");
    expect(result.kind).toBe("json");
  });

  it("falls back to detectFormat/body.stream when overrides absent", async () => {
    detectFormatMock.mockReturnValue("gemini");

    const result = await handlePonytailCommands(
      { messages: [{ role: "user", content: "/ponytail-help" }], stream: true },
      "demo-model",
      { helpText: "HELP" },
    );

    expect(createStreamingResponse).toHaveBeenCalledWith("gemini", "demo-model", "HELP");
    expect(result.kind).toBe("sse");
  });
});
