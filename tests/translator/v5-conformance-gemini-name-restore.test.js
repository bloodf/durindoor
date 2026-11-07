import { describe, expect, it, vi } from "vitest";
import "./registerAll.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  saveUsageStats: vi.fn(() => Promise.resolve()),
}));

const aliasMap = new Map([["ns_search", "ns.search"]]);

const run = async (targetFormat, providerBody) => {
  const result = await handleNonStreamingResponse({
    providerResponse: {
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve(JSON.stringify(providerBody)),
      status: 200,
      statusText: "OK",
    },
    provider: "openai",
    model: "m",
    sourceFormat: FORMATS.GEMINI,
    targetFormat,
    body: { model: "m", contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    stream: false,
    streamToClient: false,
    requestStartTime: Date.now(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    toolNameMap: aliasMap,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    onRequestSuccess: vi.fn(() => Promise.resolve()),
    terminalProvenance: "upstream",
  });
  expect(result.success).toBe(true);
  return result.response.json();
};

const names = (json) => (json.response ?? json).candidates[0].content.parts.map((p) => p.functionCall?.name).filter(Boolean);

describe("#1089 non-stream Gemini replies restore request-side tool aliases", () => {
  it("restores ns.search from a Chat upstream", async () => {
    const json = await run(FORMATS.OPENAI, {
      id: "c", model: "m", object: "chat.completion",
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "ns_search", arguments: "{}" } }] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    expect(names(json)).toEqual(["ns.search"]);
  });

  it("restores ns.search from a Responses upstream", async () => {
    const json = await run(FORMATS.OPENAI_RESPONSES, {
      id: "r", object: "response", status: "completed", model: "m",
      output: [{ type: "function_call", call_id: "c1", name: "ns_search", arguments: "{}" }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    expect(names(json)).toEqual(["ns.search"]);
  });
});
