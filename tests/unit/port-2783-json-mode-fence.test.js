import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { stripJsonFence } from "../../open-sse/utils/jsonFence.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const FENCED = '```json\n{"a":1}\n```';
const JSON_MODE = { type: "json_object" };
const completion = {
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 1,
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content: FENCED }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const options = (responseFormat, overrides) => ({
  provider: "deepseek",
  model: "m",
  sourceFormat: FORMATS.OPENAI,
  targetFormat: FORMATS.OPENAI,
  body: { model: "m", messages: [], ...(responseFormat ? { response_format: responseFormat } : null) },
  stream: false,
  requestStartTime: Date.now(),
  connectionId: "conn",
  clientRawRequest: { endpoint: "/v1/chat/completions" },
  reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
  trackDone: vi.fn(),
  appendLog: vi.fn(),
  ...overrides,
});

async function contentOf(result) {
  expect(result.success).toBe(true);
  return (await result.response.json()).choices[0].message.content;
}

const jsonResult = (responseFormat) => handleNonStreamingResponse(options(responseFormat, {
  providerResponse: new Response(JSON.stringify(completion), { headers: { "content-type": "application/json" } }),
}));

const forcedSseResult = (responseFormat, targetFormat, events) => handleForcedSSEToJson(options(responseFormat, {
  targetFormat,
  provider: targetFormat === FORMATS.OPENAI_RESPONSES ? "codex" : "deepseek",
  providerResponse: new Response(`${events.map((data) => `data: ${JSON.stringify(data)}\n\n`).join("")}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  }),
}));

const chatEvents = [
  { id: "c", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta: { role: "assistant", content: FENCED }, finish_reason: null }] },
  { id: "c", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
];
const responsesEvents = [{
  type: "response.completed",
  response: {
    id: "resp_1",
    status: "completed",
    output: [{ id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: FENCED }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  },
}];

describe("upstream 9router #2783: JSON mode answers are not left inside a markdown fence", () => {
  it.each([
    ["a JSON provider reply", jsonResult],
    ["a forced Chat SSE reply", (rf) => forcedSseResult(rf, FORMATS.OPENAI, chatEvents)],
    ["a forced Responses SSE reply", (rf) => forcedSseResult(rf, FORMATS.OPENAI_RESPONSES, responsesEvents)],
  ])("unwraps %s only when JSON output was requested", async (_name, run) => {
    expect(await contentOf(await run(JSON_MODE))).toBe('{"a":1}');
    expect(await contentOf(await run(null))).toBe(FENCED);
  });

  it.each([
    ['```\n{"a":1}\n```', '{"a":1}'],
    ['  ```JSON\r\n{"a":1}\r\n```  ', '{"a":1}'],
    ['Here:\n```json\n{"a":1}\n```', 'Here:\n```json\n{"a":1}\n```'],
    ['```python\nprint(1)\n```', '```python\nprint(1)\n```'],
    ['```json\n{"a":1}', '```json\n{"a":1}'],
    ['```', '```'],
    [null, null],
  ])("maps %j to %j", (input, expected) => {
    expect(stripJsonFence(input)).toBe(expected);
  });

  it("tells prompt-instructed providers not to fence the JSON", () => {
    const messages = [{ role: "user", content: "hi" }];
    const claude = openaiToClaudeRequest("claude-sonnet-4-6", { messages, response_format: JSON_MODE }, false);
    const compatible = new DefaultExecutor("openai-compatible-chat-x").applyJsonSchemaFallback({
      messages,
      response_format: { type: "json_schema", json_schema: { name: "x", schema: { type: "object" } } },
    });

    expect(JSON.stringify(claude.system)).toContain("no markdown code fences");
    expect(compatible.messages[0].content).toContain("no markdown code fences");
  });
});
