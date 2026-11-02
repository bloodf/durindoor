// Locks image-detail omission and Gemini audio mapping. Claude rejects input_audio before content extraction.
import { describe, it, expect, vi } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { convertOpenAIContentToParts } from "../../open-sse/translator/formats/gemini.js";
import "../translator/registerAll.js";

const dispatch = vi.hoisted(() => vi.fn(() => { throw new Error("Unexpected executor dispatch"); }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: dispatch }) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  maskSensitiveUrl: (value) => value,
  createRequestLogger: async () => ({ logClientRawRequest() {}, logRawRequest() {}, logTargetRequest() {}, logProviderResponse() {}, logConvertedResponse() {}, logError() {} }),
}));
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe.each([false, true])("original audio rejection before modality stripping (stream=%s)", (stream) => {
  const audio = { type: "input_audio", input_audio: { data: "QUJD", format: "wav" } };
  it.each([
    ["audio-only", [audio]],
    ["mixed", [{ type: "text", text: "transcribe" }, audio]],
    ["malformed", [{ type: "input_audio" }]],
  ])("rejects %s without dispatch on Claude and Antigravity Claude", async (_name, content) => {
    for (const provider of ["anthropic-compatible-proof", "antigravity"]) {
      dispatch.mockClear();
      const body = { model: "claude-sonnet-4-6", stream, messages: [{ role: "user", content: structuredClone(content) }] };
      const original = structuredClone(body.messages);
      const result = await handleChatCore({ body, modelInfo: { provider, model: body.model }, credentials: { apiKey: "fake", providerSpecificData: {} }, sourceFormatOverride: "openai", clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, rtkEnabled: false, headroomEnabled: false, pxpipeEnabled: false, cavemanEnabled: false, ponytailEnabled: false });
      expect(result.status).toBe(400);
      expect(result.response.status).toBe(400);
      expect((await result.response.json()).error.message).toMatch(/input_audio.*not supported/);
      expect(dispatch).not.toHaveBeenCalled();
      expect(body.messages).toEqual(original);
    }
  });
});

function userImage(detail) {
  return {
    model: "claude-sonnet-4-6",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAB", detail } },
      ],
    }],
  };
}

describe("openai→claude: image_url.detail is dropped", () => {
  it("converts image to base64 source WITHOUT a detail field", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4-6", userImage("high"), false);
    const imgBlock = out.messages[0].content.find((b) => b.type === "image");
    expect(imgBlock).toBeTruthy();
    expect(imgBlock.source).toEqual({ type: "base64", media_type: "image/png", data: "AAAB" });
    expect("detail" in imgBlock).toBe(false);
    expect("detail" in imgBlock.source).toBe(false);
  });
});

describe("openai→gemini: input_audio is mapped to inlineData", () => {
  it("maps wav → audio/wav inlineData", () => {
    const parts = convertOpenAIContentToParts([{ type: "input_audio", input_audio: { data: "ZZZ", format: "wav" } }]);
    expect(parts).toEqual([{ inlineData: { mimeType: "audio/wav", data: "ZZZ" } }]);
  });

  it("maps mp3 → audio/mpeg inlineData", () => {
    const parts = convertOpenAIContentToParts([{ type: "input_audio", input_audio: { data: "ZZZ", format: "mp3" } }]);
    expect(parts[0].inlineData.mimeType).toBe("audio/mpeg");
  });

  it("drops image_url.detail (not carried into inlineData)", () => {
    const parts = convertOpenAIContentToParts([{ type: "image_url", image_url: { url: "data:image/png;base64,AAAB", detail: "high" } }]);
    expect(parts).toEqual([{ inlineData: { mimeType: "image/png", data: "AAAB" } }]);
  });
});
