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

// #1089: a Gemini client must receive a Gemini-shaped body whatever the upstream dialect or
// buffering path. Native GEMINI is top-level candidates; GEMINI_CLI keeps the { response } envelope.
const common = {
  provider: "p", model: "m", body: { model: "m", contents: [{ role: "user", parts: [{ text: "hi" }] }] },
  stream: false, streamToClient: false, requestStartTime: Date.now(),
  reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
  toolNameMap: null, trackDone: vi.fn(), appendLog: vi.fn(),
  onRequestSuccess: vi.fn(() => Promise.resolve()), terminalProvenance: "upstream",
};

const nonStream = async (sourceFormat, targetFormat, upstream) => {
  const result = await handleNonStreamingResponse({
    ...common, sourceFormat, targetFormat,
    providerResponse: {
      headers: new Map([["content-type", "application/json"]]),
      text: () => Promise.resolve(JSON.stringify(upstream)),
      status: 200, statusText: "OK",
    },
  });
  expect(result.success).toBe(true);
  return result.response.json();
};

const claudeReply = {
  id: "msg_1", type: "message", role: "assistant", model: "claude-x", stop_reason: "tool_use",
  content: [{ type: "text", text: "calling" }, { type: "tool_use", id: "tu1", name: "ns_search", input: { q: 1 } }],
  usage: { input_tokens: 3, output_tokens: 4 },
};

const geminiUpstream = {
  response: {
    candidates: [{ content: { role: "model", parts: [{ text: "calling" }, { functionCall: { name: "ns_search", args: { q: 1 } } }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
    modelVersion: "g",
  },
};

const chatUpstream = {
  id: "c", object: "chat.completion", model: "m",
  choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "calling", tool_calls: [{ id: "c1", type: "function", function: { name: "ns_search", arguments: '{"q":1}' } }] } }],
  usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
};

const parts = (json) => (json.response ?? json).candidates[0].content.parts;

describe("#1089 buffered JSON replies reach a Gemini client Gemini-shaped", () => {
  it.each([
    ["Claude upstream", FORMATS.CLAUDE, claudeReply],
    ["Gemini-CLI upstream", FORMATS.GEMINI_CLI, geminiUpstream],
    ["Chat upstream", FORMATS.OPENAI, chatUpstream],
  ])("native Gemini client from a %s gets top-level candidates", async (_l, target, upstream) => {
    const json = await nonStream(FORMATS.GEMINI, target, upstream);
    expect(json.object).toBeUndefined();
    expect(json.choices).toBeUndefined();
    expect(json.candidates[0].content.parts.map((p) => p.functionCall?.name).filter(Boolean)).toEqual(["ns_search"]);
    expect(json.usageMetadata).toMatchObject({ promptTokenCount: 3 });
    expect(json.candidates[0].finishReason).toBe("STOP");
  });

  it.each([
    ["Claude upstream", FORMATS.CLAUDE, claudeReply],
    ["Chat upstream", FORMATS.OPENAI, chatUpstream],
  ])("Gemini-CLI client from a %s keeps the { response } envelope", async (_l, target, upstream) => {
    const json = await nonStream(FORMATS.GEMINI_CLI, target, upstream);
    expect(json.choices).toBeUndefined();
    expect(parts(json).map((p) => p.functionCall?.name).filter(Boolean)).toEqual(["ns_search"]);
    expect(json.response.candidates).toBeDefined();
  });
});

const sse = (frames) => frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const responsesRaw = sse([
  ["response.created", { response: { id: "r", created_at: 1 } }],
  ["response.output_item.done", { output_index: 0, item: { type: "function_call", id: "fc1", call_id: "c1", name: "ns_search", arguments: "{}" } }],
  ["response.completed", { response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }],
]);
const chatRaw = [
  { id: "c", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "ns_search", arguments: "{}" } }] }, finish_reason: null }] },
  { id: "c", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
].map((c) => `data: ${JSON.stringify(c)}`).concat("data: [DONE]", "").join("\n\n");

const forced = async (sourceFormat, targetFormat, raw) => {
  const result = await handleForcedSSEToJson({
    ...common, sourceFormat, targetFormat, providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    stream: true, translatedBody: null, finalBody: null, connectionId: "c", apiKey: null,
    clientRawRequest: { endpoint: "/v1beta/models/m:generateContent" }, log: { line: vi.fn(), debug: vi.fn() }, usageEventId: "e",
  });
  expect(result.success).toBe(true);
  return result.response.json();
};

describe("#1089 forced-SSE JSON replies reach a Gemini client Gemini-shaped", () => {
  it.each([
    ["Responses", FORMATS.OPENAI_RESPONSES, responsesRaw],
    ["Chat", FORMATS.OPENAI, chatRaw],
  ])("native Gemini client from a %s stream gets top-level candidates", async (_l, target, raw) => {
    const json = await forced(FORMATS.GEMINI, target, raw);
    expect(json.response).toBeUndefined();
    expect(json.candidates[0].content.parts.some((p) => p.functionCall)).toBe(true);
  });

  it("Gemini-CLI client keeps the { response } envelope", async () => {
    const json = await forced(FORMATS.GEMINI_CLI, FORMATS.OPENAI_RESPONSES, responsesRaw);
    expect(json.response.candidates[0].content.parts.some((p) => p.functionCall)).toBe(true);
  });
});

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
