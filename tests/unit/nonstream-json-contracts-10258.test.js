import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

function makeProviderResponse(text) {
  return {
    headers: new Map([["content-type", "application/json"]]),
    text: () => Promise.resolve(text),
    status: 200,
    statusText: "OK",
  };
}

function options(providerResponse, provider = "galadriel") {
  return {
    providerResponse,
    provider,
    model: "galadriel-latest",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { model: "galadriel-latest", messages: [] },
    stream: false,
    streamToClient: false,
    requestStartTime: Date.now(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    toolNameMap: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  };
}

describe("handleNonStreamingResponse JSON contracts", () => {
  it.each([
    ["null", "null", "galadriel"],
    ["primitive", "true", "galadriel"],
    ["array", "[]", "galadriel"],
    ["ClinePass envelope array", '{"success":true,"data":[]}', "clinepass"],
  ])("rejects parsed %s JSON before response handling", async (_kind, text, provider) => {
    const result = await handleNonStreamingResponse(options(makeProviderResponse(text), provider));

    expect(result).toMatchObject({
      success: false,
      status: 502,
      error: `Invalid JSON response from ${provider}`,
    });
  });

  it("continues valid JSON records through the production response path", async () => {
    const result = await handleNonStreamingResponse(options(makeProviderResponse(JSON.stringify({
      id: "chatcmpl-valid",
      object: "chat.completion",
      created: 123,
      model: "galadriel-latest",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }))));

    expect(result.success).toBe(true);
    await expect(result.response.json()).resolves.toMatchObject({
      id: "chatcmpl-valid",
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    });
  });
});
