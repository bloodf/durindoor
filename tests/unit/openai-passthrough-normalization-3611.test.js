import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const encoder = new TextEncoder();

async function passthrough(input, body = {}) {
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    }
  });
  const transform = createPassthroughStreamWithLogger(
    "openai", null, null, "gpt-test", "connection-test", body,
    null, null, FORMATS.OPENAI
  );
  return new Response(source.pipeThrough(transform)).text();
}

function nonStreamingOptions(responseBody) {
  return {
    providerResponse: Response.json(responseBody),
    provider: "openai",
    model: "gpt-test",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { model: "gpt-test", messages: [] },
    stream: false,
    streamToClient: false,
    requestStartTime: Date.now(),
    connectionId: "connection-test",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    log: { warn: vi.fn(), line: vi.fn() }
  };
}

function forcedOptions(raw) {
  return {
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    provider: "openai",
    model: "gpt-test",
    body: { model: "gpt-test", stream: false },
    stream: true,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "connection-test",
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess: vi.fn(async () => {}),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    log: { line: vi.fn() },
    terminalProvenance: "upstream"
  };
}

const sse = (...chunks) => `${chunks.map((chunk) =>
  `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}`).join("\n\n")}\n\n`;

const toolCalls = [{
  index: 0,
  id: "call_1",
  type: "function",
  function: { name: "run", arguments: "{}" }
}];

describe("OpenAI passthrough terminal normalization (upstream #3611)", () => {
  it("emits one DONE sentinel when upstream repeats it", async () => {
    const output = await passthrough(sse(
      { choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      "[DONE]",
      "[DONE]"
    ));

    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("deduplicates terminal chunks per choice without suppressing another choice", async () => {
    const output = await passthrough(sse(
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
        { index: 1, delta: {}, finish_reason: "length" }
      ] },
      "[DONE]"
    ), { n: 2 });
    const terminals = output.split("\n").
      filter((line) => line.startsWith("data: {") && line.includes("finish_reason")).
      flatMap((line) => JSON.parse(line.slice(6)).choices).
      map(({ index, finish_reason }) => [index, finish_reason]);

    expect(terminals).toEqual([[0, "stop"], [1, "length"]]);
  });

  it("normalizes non-empty reasoning only when reasoning_content is falsy", async () => {
    const output = await passthrough(sse(
      { choices: [
        { index: 0, delta: { reasoning: "legacy" }, finish_reason: null },
        { index: 1, delta: { reasoning: "ignored", reasoning_content: "canonical" }, finish_reason: null },
        { index: 2, delta: { reasoning: "fallback", reasoning_content: "" }, finish_reason: null }
      ] },
      { choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
        { index: 1, delta: {}, finish_reason: "stop" },
        { index: 2, delta: {}, finish_reason: "stop" }
      ] },
      "[DONE]"
    ), { n: 3 });
    const line = output.split("\n").find((candidate) => candidate.includes("legacy"));
    const reasoning = JSON.parse(line.slice(6)).choices;

    expect(reasoning[0].delta).toEqual({ reasoning: "legacy", reasoning_content: "legacy" });
    expect(reasoning[1].delta).toEqual({ reasoning: "ignored", reasoning_content: "canonical" });
    expect(reasoning[2].delta).toEqual({ reasoning: "fallback", reasoning_content: "fallback" });
  });

  it("suppresses whitespace-only legacy reasoning", async () => {
    const output = await passthrough(sse(
      { choices: [{ index: 0, delta: { reasoning: "  " }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      "[DONE]"
    ));

    expect(output).not.toContain('"reasoning":"  "');
    expect(output).not.toContain("reasoning_content");
  });

  it("leaves empty legacy reasoning unchanged on content frames", async () => {
    const output = await passthrough(sse(
      { choices: [{ index: 0, delta: { content: "hi", reasoning: "" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      "[DONE]"
    ));
    const line = output.split("\n").find((candidate) => candidate.includes('"content":"hi"'));

    expect(JSON.parse(line.slice(6)).choices[0].delta).toEqual({ content: "hi", reasoning: "" });
  });

  it("does not synthesize DONE after a terminal choice followed by bare empty choices", async () => {
    const terminal = sse({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    const emptyChoices = `data: ${JSON.stringify({ choices: [] })}`;
    const output = await passthrough(`${terminal}${emptyChoices}`);

    expect(output).not.toContain("data: [DONE]");
  });

  it("separates a synthetic DONE sentinel from an unterminated final frame", async () => {
    const terminal = `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`;
    const output = await passthrough(terminal);

    expect(output).toMatch(/}\n\ndata: \[DONE\]\n\n$/);
  });
});

describe("masked HTTP-200 gateway errors (upstream #3611)", () => {
  it("rejects a non-streaming native gateway error with empty content", async () => {
    const result = await handleNonStreamingResponse(nonStreamingOptions({
      choices: [{
        index: 0,
        message: { role: "assistant", content: "" },
        finish_reason: "stop",
        native_finish_reason: "network_error"
      }]
    }));

    expect(result).toMatchObject({ success: false, status: 502, error: "Upstream provider error: network_error" });
  });

  it("keeps a non-streaming tool call successful despite a native error reason", async () => {
    const result = await handleNonStreamingResponse(nonStreamingOptions({
      choices: [{
        index: 0,
        message: { role: "assistant", content: null, tool_calls: toolCalls },
        finish_reason: "tool_calls",
        native_finish_reason: "network_error"
      }]
    }));

    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.tool_calls).toHaveLength(1);
  });

  it("rejects a forced SSE-to-JSON native gateway error with empty content", async () => {
    const result = await handleForcedSSEToJson(forcedOptions(sse(
      { choices: [{ index: 0, delta: {}, finish_reason: "stop", native_finish_reason: "timeout" }] },
      "[DONE]"
    )));

    expect(result).toMatchObject({ success: false, status: 502, error: "Upstream provider error: timeout" });
  });

  it("keeps a forced SSE-to-JSON tool call successful despite a native error reason", async () => {
    const result = await handleForcedSSEToJson(forcedOptions(sse(
      { choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls", native_finish_reason: "network_error" }] },
      "[DONE]"
    )));

    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.tool_calls).toHaveLength(1);
  });
});
