import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));

import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { ensureToolCallIds } from "../../open-sse/translator/concerns/toolCall.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { getCodeBuddyCnUsage } from "../../open-sse/services/usage/codebuddy-cn.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...await importOriginal(), proxyAwareFetch: vi.fn() }));

const chunk = (delta, finish_reason = null) => ({ id: "chatcmpl-abcdefghij", model: "m", choices: [{ index: 0, delta, finish_reason }] });
const call = (fields) => chunk({ tool_calls: [fields] });
const named = (id, name, args, extra = {}) => ({ ...extra, ...(id ? { id } : {}), function: { ...(name ? { name } : {}), arguments: args } });
const finish = chunk({}, "tool_calls");

/** Replay the Claude events into ordered blocks, rejecting a delta for a closed block. */
function claudeBlocks(chunks) {
  const state = initState("claude");
  const events = [...chunks, null].flatMap((item) => translateResponse("openai", "claude", item, state) || []);
  const blocks = new Map();
  const order = [];
  for (const event of events) {
    if (event.type === "content_block_start") {
      blocks.set(event.index, { ...event.content_block, json: "", closed: false });
      order.push(`start${event.index}`);
    } else if (event.type === "content_block_delta") {
      expect(blocks.get(event.index).closed).toBe(false);
      blocks.get(event.index).json += event.delta.partial_json ?? "";
    } else if (event.type === "content_block_stop") {
      expect(blocks.get(event.index).closed).toBe(false);
      blocks.get(event.index).closed = true;
      order.push(`stop${event.index}`);
    }
  }
  const tools = [...blocks.values()].filter((block) => block.type === "tool_use");
  return { tools, order, calls: tools.map((block) => [block.id, block.name, JSON.parse(block.json || "{}")]) };
}

describe("upstream #4511 - Claude tool stream state", () => {
  it("keeps two calls apart when the provider reuses an index", () => {
    const { calls } = claudeBlocks([call(named("t1", "alpha", '{"a":1}', { index: 0 })), call(named("t2", "beta", '{"b":', { index: 0 })), call(named(null, null, "2}", { index: 0 })), finish]);
    expect(calls).toEqual([["t1", "alpha", { a: 1 }], ["t2", "beta", { b: 2 }]]);
  });

  it("keeps parallel calls apart when no index is sent", () => {
    const { calls } = claudeBlocks([call(named("t1", "alpha", '{"a":1}')), call(named("t2", "beta", '{"b":2}')), finish]);
    expect(calls).toEqual([["t1", "alpha", { a: 1 }], ["t2", "beta", { b: 2 }]]);
  });

  it("keeps fragments together when the id changes before the arguments are whole", () => {
    const { calls } = claudeBlocks([call(named("t1", "alpha", '{"a":', { index: 0 })), call(named("other", null, "1}", { index: 0 })), finish]);
    expect(calls).toEqual([["t1", "alpha", { a: 1 }]]);
  });

  it("gives a named call without an id a generated one", () => {
    const { calls } = claudeBlocks([call(named(null, "alpha", '{"a":1}', { index: 0 })), finish]);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatch(/^call_/);
    expect(calls[0].slice(1)).toEqual(["alpha", { a: 1 }]);
  });

  it("keeps arguments that arrive before the id", () => {
    const { calls } = claudeBlocks([call(named(null, null, '{"a":', { index: 0 })), call(named("t1", "alpha", "1}", { index: 0 })), finish]);
    expect(calls).toEqual([["t1", "alpha", { a: 1 }]]);
  });

  it("closes a whole tool call before text opens", () => {
    const { order } = claudeBlocks([call(named("t1", "alpha", '{"a":1}', { index: 0 })), chunk({ content: "after" }), finish]);
    expect(order).toEqual(["start0", "stop0", "start1", "stop1"]);
  });

  it("keeps a partial tool call open across text so no argument is lost", () => {
    const { calls } = claudeBlocks([call(named("t1", "alpha", '{"a":', { index: 0 })), chunk({ content: "note" }), call(named(null, null, "1}", { index: 0 })), finish]);
    expect(calls).toEqual([["t1", "alpha", { a: 1 }]]);
  });
});

describe("upstream #4511 - tool ids and names", () => {
  it("generates an id for a tool_use that has none and pairs its result", () => {
    const body = { messages: [{ role: "assistant", content: [{ type: "tool_use", name: "alpha", input: {} }] }, { role: "user", content: [{ type: "tool_result", content: "x" }] }] };
    const [assistant, user] = ensureToolCallIds(body, "claude").messages;
    expect(assistant.content[0].id).toBeTruthy();
    expect(user.content[0].tool_use_id).toBe(assistant.content[0].id);
  });

  it("gives parallel Antigravity calls distinct ids, ahead of their results", () => {
    const request = { request: { contents: [
      { role: "model", parts: [{ functionCall: { name: "alpha", args: { a: 1 } } }, { functionCall: { name: "alpha", args: { a: 2 } } }] },
      { role: "user", parts: [{ functionResponse: { name: "alpha", response: { result: "1" } } }, { functionResponse: { name: "alpha", response: { result: "2" } } }] },
    ] } };
    const messages = translateRequest("antigravity", "openai", "m", request, true, null, null).messages;
    expect(messages[0].tool_calls.map((item) => item.id)).toEqual(["call_alpha", "call_alpha_1"]);
    expect(messages.slice(1).map((item) => item.tool_call_id)).toEqual(["call_alpha", "call_alpha_1"]);
  });

  it("puts the calling message before results sharing its content", () => {
    const request = { request: { contents: [{ role: "model", parts: [{ functionCall: { id: "c1", name: "alpha", args: {} } }, { functionResponse: { id: "c1", name: "alpha", response: { result: "1" } } }] }] } };
    const messages = translateRequest("antigravity", "openai", "m", request, true, null, null).messages;
    expect(messages.map((item) => item.role)).toEqual(["assistant", "tool"]);
  });

  const sse = (chunks) => chunks.map((item) => `data: ${JSON.stringify(item)}\n\n`).join("") + "data: [DONE]\n\n";

  it("keeps indexless calls apart in forced SSE to JSON and reports tool_calls", () => {
    const [choice] = parseSSEToOpenAIResponse(sse([call(named("t1", "alpha", '{"a":1}')), call(named("t2", "beta", '{"b":2}')), chunk({}, "stop")]), "m").choices;
    expect(choice.message.tool_calls.map((item) => [item.id, item.function.name, item.function.arguments])).toEqual([["t1", "alpha", '{"a":1}'], ["t2", "beta", '{"b":2}']]);
    expect(choice.finish_reason).toBe("tool_calls");
  });

  it("does not concatenate a repeated name", () => {
    const frames = [call(named("t1", "alpha", '{"a":', { index: 0 })), call(named(null, "alpha", "1}", { index: 0 }))];
    expect(parseSSEToOpenAIResponse(sse([...frames, finish]), "m").choices[0].message.tool_calls[0].function)
      .toEqual({ name: "alpha", arguments: '{"a":1}' });
    const state = {};
    const out = [...frames, finish].map((item) => openaiToAntigravityResponse(item, state)).filter(Boolean);
    expect(out.at(-1).response.candidates[0].content.parts[0].functionCall).toMatchObject({ name: "alpha", args: { a: 1 } });
  });

  it("does not cut a high-output model's max_tokens to the default ceiling", () => {
    const body = { messages: [{ role: "user", content: "hi" }], max_tokens: 100000 };
    expect(translateRequest("claude", "openai", "claude-opus-5", structuredClone(body), true, null, "anthropic").max_tokens).toBe(100000);
    expect(translateRequest("claude", "openai", "unknown-model", structuredClone(body), true, null, "openai").max_tokens).toBe(64000);
  });

  it("sends CodeBuddy CN a leading system message when the caller has none", () => {
    const { messages } = new CodeBuddyExecutor().transformRequest("m", { messages: [{ role: "user", content: "hi" }] }, true, {});
    expect(messages.map((item) => item.role)).toEqual(["system", "user"]);
  });
});

describe("upstream #4511 - CodeBuddy quota retry", () => {
  it.each([[500, 3], [401, 1]])("calls the billing gateway for HTTP %i %i time(s)", async (status, calls) => {
    vi.mocked(proxyAwareFetch).mockReset();
    vi.mocked(proxyAwareFetch).mockImplementation(async () => new Response("", { status }));
    expect((await getCodeBuddyCnUsage("token")).message).toContain("CodeBuddy CN");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(calls);
  });
});
