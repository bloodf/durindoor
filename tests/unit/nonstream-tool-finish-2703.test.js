import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_STOP, OPENAI_FINISH } from "../../open-sse/translator/schema/finishReasons.js";
import { ROLE } from "../../open-sse/translator/schema/roles.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

async function run(finishReason, streamToClient, withTool = true) {
  const message = { role: ROLE.ASSISTANT, content: withTool ? null : "finished" };
  if (withTool) message.tool_calls = [{ id: "call_1", type: "function", function: { name: "lookup", arguments: finishReason === OPENAI_FINISH.LENGTH ? '{"query":' : '{"query":"ok"}' } }];
  const payload = { id: "chatcmpl-test", model: "test", choices: [{ index: 0, message, finish_reason: finishReason }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  const result = await handleNonStreamingResponse({
    providerResponse: Response.json(payload), provider: "galadriel", model: "test",
    sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
    body: { messages: [] }, stream: false, streamToClient, requestStartTime: Date.now(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    trackDone: vi.fn(), appendLog: vi.fn(),
  });
  expect(result.success).toBe(true);
  if (!streamToClient) return (await result.response.json()).choices[0];
  const frames = (await result.response.text()).split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
  return { finish_reason: frames.flatMap(frame => frame.choices || []).find(choice => choice.finish_reason)?.finish_reason,
    message: { tool_calls: frames.flatMap(frame => frame.choices || []).flatMap(choice => choice.delta?.tool_calls || []) } };
}

describe.each([["JSON", false], ["JSON-to-SSE", true]])("tool finish reasons in %s", (_path, stream) => {
  it.each([
    [OPENAI_FINISH.LENGTH, OPENAI_FINISH.LENGTH],
    [OPENAI_FINISH.CONTENT_FILTER, OPENAI_FINISH.CONTENT_FILTER],
    [CLAUDE_STOP.MAX_TOKENS, OPENAI_FINISH.LENGTH],
    [CLAUDE_STOP.MODEL_CONTEXT_WINDOW_EXCEEDED, OPENAI_FINISH.LENGTH],
    [CLAUDE_STOP.REFUSAL, OPENAI_FINISH.CONTENT_FILTER],
    [OPENAI_FINISH.TOOL_CALLS, OPENAI_FINISH.TOOL_CALLS],
    [OPENAI_FINISH.STOP, OPENAI_FINISH.TOOL_CALLS],
    ["other", OPENAI_FINISH.TOOL_CALLS],
  ])("maps %s to %s with a tool call", async (reason, expected) => {
    const choice = await run(reason, stream);
    expect(choice.message.tool_calls).toHaveLength(1);
    expect(choice.finish_reason).toBe(expected);
  });
  it("keeps a normal stop without tool calls", async () => {
    expect((await run(OPENAI_FINISH.STOP, stream, false)).finish_reason).toBe(OPENAI_FINISH.STOP);
  });
});
