import { beforeEach, describe, expect, it, vi } from "vitest";

const createSyntheticResponseMock = vi.fn((options) => ({ kind: "synthetic", ...options }));
vi.mock("../../open-sse/utils/bypassResponse.js", () => ({
  createSyntheticResponse: createSyntheticResponseMock,
}));

const detectFormatMock = vi.fn(() => "openai");
vi.mock("../../open-sse/services/provider.js", () => ({
  detectFormat: (...args) => detectFormatMock(...args),
}));

const {
  extractPonytailCommand,
  handlePonytailCommands,
  resolvePonytailStream,
} = await import("../../open-sse/utils/tokenSaverBridge.js");

describe("extractPonytailCommand", () => {
  it.each([
    ["/ponytail-help", "help"],
    [" /PONYTAIL HELP\n", "help"],
    ["/ponytail-gain", "gain"],
    ["/ponytail\t  gain", "gain"],
  ])("recognizes exact command %j", (content, expected) => {
    expect(extractPonytailCommand({ messages: [{ role: "user", content }] })).toBe(expected);
  });

  it.each([
    "please /ponytail-help",
    "/ponytail-help now",
    "/ponytail_helper",
    "/ponytail",
  ])("rejects embedded or malformed text %j", (content) => {
    expect(extractPonytailCommand({ messages: [{ role: "user", content }] })).toBeNull();
  });

  it("accepts text-only Chat content blocks", () => {
    expect(extractPonytailCommand({
      messages: [{ role: "user", content: [{ type: "text", text: "/ponytail" }, { type: "text", text: "help" }] }],
    })).toBe("help");
  });

  it("accepts Responses strings and input_text blocks", () => {
    expect(extractPonytailCommand({ input: "/ponytail-help" })).toBe("help");
    expect(extractPonytailCommand({
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "/ponytail-gain" }] }],
    })).toBe("gain");
  });

  it("accepts Gemini and wrapped Antigravity text parts", () => {
    const contents = [{ role: "user", parts: [{ text: "/ponytail help" }] }];
    expect(extractPonytailCommand({ contents })).toBe("help");
    expect(extractPonytailCommand({ request: { contents } })).toBe("help");
  });

  it("requires the active final user turn", () => {
    expect(extractPonytailCommand({
      messages: [
        { role: "user", content: "/ponytail-help" },
        { role: "assistant", content: "What next?" },
      ],
    })).toBeNull();
    expect(extractPonytailCommand({
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "/ponytail-help" }] },
        { type: "function_call", name: "lookup", arguments: "{}" },
      ],
    })).toBeNull();
    expect(extractPonytailCommand({
      input: [{
        type: "function_call_output",
        role: "user",
        content: [{ type: "input_text", text: "/ponytail-help" }],
      }],
    })).toBeNull();
  });

  it("rejects mixed image, tool, and metadata blocks", () => {
    expect(extractPonytailCommand({
      messages: [{ role: "user", content: [
        { type: "text", text: "/ponytail-help" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
      ] }],
    })).toBeNull();
    expect(extractPonytailCommand({
      input: [{ type: "message", role: "user", content: [
        { type: "input_text", text: "/ponytail-help" },
        { type: "input_image", image_url: "https://example.com/a.png" },
      ] }],
    })).toBeNull();
    expect(extractPonytailCommand({
      contents: [{ role: "user", parts: [{ text: "/ponytail-help", thought: true }] }],
    })).toBeNull();
  });
});

describe("resolvePonytailStream", () => {
  it("preserves explicit stream values", () => {
    expect(resolvePonytailStream({ stream: true }, "openai", "application/json")).toBe(true);
    expect(resolvePonytailStream({ stream: false }, "openai", "text/event-stream")).toBe(false);
  });

  it("defaults Responses to JSON and honors Chat Accept headers", () => {
    expect(resolvePonytailStream({}, "openai-responses", "")).toBe(false);
    expect(resolvePonytailStream({}, "openai-responses", "text/event-stream")).toBe(true);
    expect(resolvePonytailStream({}, "openai-responses", "application/json")).toBe(false);
    expect(resolvePonytailStream({}, "openai", "application/json")).toBe(false);
    expect(resolvePonytailStream({}, "openai", "text/event-stream")).toBe(true);
  });
});

describe("handlePonytailCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectFormatMock.mockReturnValue("openai");
  });

  it("passes explicit protocol and response-mode decisions to the shared builder", async () => {
    const result = await handlePonytailCommands(
      { messages: [{ role: "user", content: "/ponytail-help" }], stream: true },
      "demo-model",
      { helpText: "HELP", sourceFormatOverride: "claude", streamOverride: false },
    );

    expect(createSyntheticResponseMock).toHaveBeenCalledWith({
      sourceFormat: "claude",
      model: "demo-model",
      text: "HELP",
      stream: false,
    });
    expect(result.kind).toBe("synthetic");
  });

  it("fetches gain stats exactly once and formats scoped totals", async () => {
    const fetchStats = vi.fn(async () => ({
      totalRequests: 12,
      totalTokens: 3456,
      totalCost: 1.25,
      scope: "this API key",
    }));
    await handlePonytailCommands(
      { input: [{ role: "user", content: [{ type: "input_text", text: "/ponytail gain" }] }] },
      "demo-model",
      { fetchStats, streamOverride: false },
    );

    expect(fetchStats).toHaveBeenCalledTimes(1);
    expect(createSyntheticResponseMock.mock.calls[0][0].text).toContain("lifetime (this API key)");
    expect(createSyntheticResponseMock.mock.calls[0][0].text).toContain("total tokens: 3,456");
    expect(createSyntheticResponseMock.mock.calls[0][0].text).toContain("est. cost: $1.25");
  });

  it.each([
    ["missing", async () => null],
    ["failed", async () => { throw new Error("offline"); }],
  ])("uses the dashboard fallback when stats are %s", async (_label, fetchStats) => {
    await handlePonytailCommands(
      { messages: [{ role: "user", content: "/ponytail-gain" }], stream: false },
      "demo-model",
      { fetchStats },
    );
    expect(createSyntheticResponseMock.mock.calls[0][0].text).toContain("available in the dashboard");
  });

  it("does not fetch stats for help or normal traffic", async () => {
    const fetchStats = vi.fn();
    await handlePonytailCommands(
      { messages: [{ role: "user", content: "/ponytail-help" }], stream: false },
      "demo-model",
      { fetchStats, helpText: "HELP" },
    );
    const normal = await handlePonytailCommands(
      { messages: [{ role: "user", content: "hello" }], stream: false },
      "demo-model",
      { fetchStats },
    );
    expect(fetchStats).not.toHaveBeenCalled();
    expect(normal).toBeNull();
  });
});
