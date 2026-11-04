import { describe, expect, it, vi } from "vitest";
import "./registerAll.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  saveUsageStats: vi.fn(() => Promise.resolve()),
}));

// #1089: a Claude client must get the original tool name back in buffered and forced-SSE replies.
const common = {
  provider: "p", model: "m", body: { model: "m", messages: [{ role: "user", content: "hi" }] },
  stream: false, streamToClient: false, requestStartTime: Date.now(),
  reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
  toolNameMap: null, trackDone: vi.fn(), appendLog: vi.fn(),
  onRequestSuccess: vi.fn(() => Promise.resolve()), terminalProvenance: "upstream",
};

const chatUpstream = {
  id: "c", object: "chat.completion", model: "m",
  choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "calling", tool_calls: [{ id: "c1", type: "function", function: { name: "ns_search", arguments: '{"q":1}' } }] } }],
  usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
};

const chatRaw = [
  { id: "c", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "ns_search", arguments: "{}" } }] }, finish_reason: null }] },
  { id: "c", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
].map((c) => `data: ${JSON.stringify(c)}`).concat("data: [DONE]", "").join("\n\n");

describe("#1089 Claude client buffered replies restore request-side tool aliases", () => {
  const aliased = (json) => ({
    ...common, sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.OPENAI, toolNameMap: new Map([["ns_search", "ns.search"]]),
    providerResponse: { headers: new Map([["content-type", "application/json"]]), text: () => Promise.resolve(JSON.stringify(json)), status: 200, statusText: "OK" },
  });

  it("restores ns.search from a Chat JSON upstream", async () => {
    const result = await handleNonStreamingResponse(aliased(chatUpstream));
    const json = await result.response.json();
    expect(json.content.find((b) => b.type === "tool_use").name).toBe("ns.search");
  });

  it("restores ns.search from a forced-SSE Chat stream", async () => {
    const result = await handleForcedSSEToJson({
      ...common, sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.OPENAI, toolNameMap: new Map([["ns_search", "ns.search"]]),
      providerResponse: new Response(chatRaw, { headers: { "content-type": "text/event-stream" } }),
      stream: true, translatedBody: null, finalBody: null, connectionId: "c", apiKey: null,
      clientRawRequest: { endpoint: "/v1/messages" }, log: { line: vi.fn(), debug: vi.fn() }, usageEventId: "e",
    });
    const json = await result.response.json();
    expect(json.content.find((b) => b.type === "tool_use").name).toBe("ns.search");
  });
});
