// Review regression for #1072: the forced-SSE → JSON path must decode DeepSeek
// DSML frames into structured tool calls before the client-format projection.
//
// The streaming path already decodes DSML chunk by chunk
// (open-sse/translator/concerns/dsml.js). The buffered path joins the very same
// frames into plain text first, so without a decode before the projection the
// client receives the raw markup instead of a tool call, in every client
// format. Ordinary provider text, invalid frames and non-DeepSeek models stay
// exactly as the provider sent them.
import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_BLOCK } from "../../open-sse/translator/schema/blocks.js";
import { CLAUDE_STOP, OPENAI_FINISH } from "../../open-sse/translator/schema/finishReasons.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

const FRAME = '<|DSML|invoke name="lookup"><|DSML|parameter name="word" string="true">hello</|DSML|parameter></|DSML|invoke>';
const CLIENT_FORMATS = [FORMATS.OPENAI, FORMATS.CLAUDE, FORMATS.GEMINI, FORMATS.OPENAI_RESPONSES];

function sseResponse(chunks) {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

/** Run the buffered (provider forced streaming, client asked for JSON) path. */
async function runBuffered({ sourceFormat, targetFormat = FORMATS.OPENAI, provider = "deepseek", model = "deepseek-chat", chunks, body = {} }) {
  const result = await handleForcedSSEToJson({
    providerResponse: sseResponse(chunks),
    sourceFormat,
    targetFormat,
    provider,
    model,
    finalBody: { model },
    body,
    requestStartTime: Date.now(),
    connectionId: "conn-1",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  });
  expect(result).not.toBeNull();
  const text = await result.response.text();
  return { text, json: JSON.parse(text), status: result.response.status, contentType: result.response.headers.get("content-type") };
}

/** The tool calls a client sees, normalized to one shape per client format. */
function clientToolCalls(json, sourceFormat) {
  if (sourceFormat === FORMATS.CLAUDE) {
    return (json.content || [])
      .filter((block) => block?.type === CLAUDE_BLOCK.TOOL_USE)
      .map((block) => ({ id: block.id, name: block.name, arguments: block.input }));
  }
  if (sourceFormat === FORMATS.GEMINI) {
    return (json.response?.candidates?.[0]?.content?.parts || [])
      .filter((part) => part?.functionCall)
      .map((part) => ({ id: part.functionCall.id, name: part.functionCall.name, arguments: part.functionCall.args }));
  }
  if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
    return (json.output || [])
      .filter((item) => item?.type === "function_call")
      .map((item) => ({ id: item.call_id, name: item.name, arguments: JSON.parse(item.arguments) }));
  }
  return (json.choices?.[0]?.message?.tool_calls || []).map((call) => ({
    id: call.id,
    name: call.function?.name,
    arguments: JSON.parse(call.function?.arguments || "{}"),
  }));
}

const splitChunks = (splitAt) => [
  { id: "chatcmpl-dsml", object: "chat.completion.chunk", created: 1, model: "deepseek-chat", choices: [{ index: 0, delta: { role: "assistant", content: "Answer " + FRAME.slice(0, splitAt), reasoning_content: "Thought" }, finish_reason: null }] },
  { id: "chatcmpl-dsml", object: "chat.completion.chunk", created: 1, model: "deepseek-chat", choices: [{ index: 0, delta: { content: FRAME.slice(splitAt) }, finish_reason: "stop" }] },
  { id: "chatcmpl-dsml", object: "chat.completion.chunk", created: 1, model: "deepseek-chat", choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
];

/** A provider body that answers with JSON instead of a stream. */
function jsonProviderResponse(body) {
  const clone = JSON.parse(JSON.stringify(body));
  return {
    headers: new Map([["content-type", "application/json"]]),
    text: () => Promise.resolve(JSON.stringify(clone)),
    json: () => Promise.resolve(clone),
    status: 200,
    statusText: "OK",
  };
}

describe("DeepSeek DSML in buffered responses", () => {
  it("decodes a split DSML frame into a structured tool call for every client format", async () => {
    for (const sourceFormat of CLIENT_FORMATS) {
      const { text, json, status, contentType } = await runBuffered({ sourceFormat, chunks: splitChunks(20) });

      expect(status, sourceFormat).toBe(200);
      expect(contentType, sourceFormat).toContain("application/json");
      expect(text, sourceFormat).not.toContain("DSML");

      const calls = clientToolCalls(json, sourceFormat);
      expect(calls, sourceFormat).toHaveLength(1);
      expect(calls[0].name, sourceFormat).toBe("lookup");
      expect(calls[0].arguments, sourceFormat).toEqual({ word: "hello" });
      // Gemini function calls carry no id in that dialect; the other formats do.
      if (sourceFormat !== FORMATS.GEMINI) {
        expect(calls[0].id, sourceFormat).toEqual(expect.any(String));
        expect(calls[0].id.length, sourceFormat).toBeGreaterThan(0);
      }

      // Surrounding literal text, reasoning and usage survive the decode.
      expect(text, sourceFormat).toContain("Answer");
      expect(text, sourceFormat).toContain("Thought");
      expect(text, sourceFormat).toContain("hello");
    }
  });

  it("reports a tool-call finish reason in each client format", async () => {
    const openai = await runBuffered({ sourceFormat: FORMATS.OPENAI, chunks: splitChunks(20) });
    expect(openai.json.choices[0].finish_reason).toBe(OPENAI_FINISH.TOOL_CALLS);

    const claude = await runBuffered({ sourceFormat: FORMATS.CLAUDE, chunks: splitChunks(20) });
    expect(claude.json.stop_reason).toBe(CLAUDE_STOP.TOOL_USE);

    const gemini = await runBuffered({ sourceFormat: FORMATS.GEMINI, chunks: splitChunks(20) });
    expect(gemini.json.response.candidates[0].finishReason).toBe("STOP");

    const responses = await runBuffered({ sourceFormat: FORMATS.OPENAI_RESPONSES, chunks: splitChunks(20) });
    expect(responses.json.status).toBe("completed");
    expect(responses.json.output.some((item) => item?.type === "function_call")).toBe(true);
  });

  it("decodes the frame no matter where the upstream split it", async () => {
    for (let splitAt = 0; splitAt <= FRAME.length; splitAt++) {
      const { text, json } = await runBuffered({ sourceFormat: FORMATS.OPENAI, chunks: splitChunks(splitAt) });
      expect(text, `split at ${splitAt}`).not.toContain("DSML");
      const calls = clientToolCalls(json, FORMATS.OPENAI);
      expect(calls, `split at ${splitAt}`).toHaveLength(1);
      expect(calls[0].arguments, `split at ${splitAt}`).toEqual({ word: "hello" });
    }
  });

  it("preserves structured tool calls that already exist next to a DSML frame", async () => {
    const chunks = [
      { id: "chatcmpl-dsml", object: "chat.completion.chunk", created: 1, model: "deepseek-chat", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_existing", type: "function", function: { name: "existing", arguments: "{\"a\":1}" } }] }, finish_reason: null }] },
      { id: "chatcmpl-dsml", object: "chat.completion.chunk", created: 1, model: "deepseek-chat", choices: [{ index: 0, delta: { content: "Answer " + FRAME }, finish_reason: "stop" }] },
      { id: "chatcmpl-dsml", object: "chat.completion.chunk", created: 1, model: "deepseek-chat", choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
    ];
    const { text, json } = await runBuffered({ sourceFormat: FORMATS.OPENAI, chunks });

    expect(text).not.toContain("DSML");
    const calls = clientToolCalls(json, FORMATS.OPENAI);
    expect(calls.map((call) => call.name)).toEqual(["existing", "lookup"]);
    expect(calls[0].id).toBe("call_existing");
    expect(calls[0].arguments).toEqual({ a: 1 });
    expect(calls[1].arguments).toEqual({ word: "hello" });
  });

  it("keeps ordinary provider text, reasoning and usage untouched", async () => {
    const chunks = [
      { id: "chatcmpl-plain", object: "chat.completion.chunk", created: 1, model: "deepseek-chat", choices: [{ index: 0, delta: { role: "assistant", content: "plain answer", reasoning_content: "private work" }, finish_reason: "stop" }] },
      { id: "chatcmpl-plain", object: "chat.completion.chunk", created: 1, model: "deepseek-chat", choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
    ];
    const { json } = await runBuffered({ sourceFormat: FORMATS.OPENAI, chunks });

    expect(json.choices[0].message.content).toBe("plain answer");
    expect(json.choices[0].message.reasoning_content).toBe("private work");
    expect(json.choices[0].message.tool_calls).toBeUndefined();
    expect(json.choices[0].finish_reason).toBe(OPENAI_FINISH.STOP);
    expect(json.usage).toEqual({ prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 });
  });

  it("leaves invalid and literal DSML snippets as text", async () => {
    const literals = [
      FRAME.slice(0, -1),
      '<|DSML|invoke name="lookup"><|DSML|parameter name="word" string="false">not-json</|DSML|parameter></|DSML|invoke>',
      '<|DSML|calls>oops</|DSML|calls>',
      "1 < 2 and 3 > 2",
    ];
    for (const literal of literals) {
      const chunks = [
        { id: "chatcmpl-literal", object: "chat.completion.chunk", created: 1, model: "deepseek-chat", choices: [{ index: 0, delta: { role: "assistant", content: literal }, finish_reason: "stop" }] },
      ];
      const { json } = await runBuffered({ sourceFormat: FORMATS.OPENAI, chunks });
      expect(json.choices[0].message.content, literal).toBe(literal);
      expect(json.choices[0].message.tool_calls, literal).toBeUndefined();
    }
  });

  it("does not decode DSML for models outside the DeepSeek family", async () => {
    const chunks = [
      { id: "chatcmpl-other", object: "chat.completion.chunk", created: 1, model: "gpt-5", choices: [{ index: 0, delta: { role: "assistant", content: "Answer " + FRAME }, finish_reason: "stop" }] },
    ];
    const { json } = await runBuffered({ sourceFormat: FORMATS.OPENAI, provider: "openai", model: "gpt-5", chunks });

    expect(json.choices[0].message.content).toBe("Answer " + FRAME);
    expect(json.choices[0].message.tool_calls).toBeUndefined();
  });

  it("keeps the shipped streaming normalization", async () => {
    const stream = createSSEStream({ mode: "translate", targetFormat: FORMATS.OPENAI, sourceFormat: FORMATS.OPENAI, model: "alias", providerBody: { model: "deepseek-chat" } });
    const input = splitChunks(20).map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    const output = await new Response(new Response(input).body.pipeThrough(stream)).text();

    expect(output).toContain("tool_calls");
    expect(output).toContain('"name":"lookup"');
    expect(output).not.toContain("DSML");
  });

  it("decodes a DSML frame carried by the native Claude transport", async () => {
    const events = [
      { type: "message_start", message: { id: "msg_dsml", type: "message", role: "assistant", model: "deepseek-chat", content: [], stop_reason: null, usage: { input_tokens: 3, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Answer " + FRAME } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: CLAUDE_STOP.END_TURN, stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ];
    const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(body, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.CLAUDE,
      provider: "deepseek",
      model: "deepseek-chat",
      finalBody: { model: "deepseek-chat" },
      body: { model: "deepseek-chat", messages: [] },
      requestStartTime: Date.now(),
      connectionId: "conn-1",
      clientRawRequest: { endpoint: "/v1/messages" },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });
    const text = await result.response.text();
    const json = JSON.parse(text);

    expect(text).not.toContain("DSML");
    expect(json.content).toContainEqual({ type: CLAUDE_BLOCK.TEXT, text: "Answer " });
    const toolUse = json.content.filter((block) => block?.type === CLAUDE_BLOCK.TOOL_USE);
    expect(toolUse).toHaveLength(1);
    expect(toolUse[0].name).toBe("lookup");
    expect(toolUse[0].input).toEqual({ word: "hello" });
    expect(json.stop_reason).toBe(CLAUDE_STOP.TOOL_USE);
  });

  it("decodes a DSML frame in a buffered provider body answered as client SSE", async () => {
    const completion = {
      id: "chatcmpl-dsml",
      object: "chat.completion",
      created: 1,
      model: "deepseek-chat",
      choices: [{ index: 0, message: { role: "assistant", content: "Answer " + FRAME, reasoning_content: "Thought" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    };
    const result = await handleNonStreamingResponse({
      providerResponse: jsonProviderResponse(completion),
      provider: "deepseek",
      model: "deepseek-chat",
      finalBody: { model: "deepseek-chat" },
      body: { model: "deepseek-chat", messages: [] },
      stream: false,
      streamToClient: true,
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      requestStartTime: Date.now(),
      connectionId: "conn-1",
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });
    const text = await result.response.text();

    expect(text).not.toContain("DSML");
    expect(text).toContain("tool_calls");
    expect(text).toContain('"name":"lookup"');
  });

  it("decodes a DSML frame in a buffered native Claude provider body", async () => {
    const claudeMessage = {
      id: "msg_dsml",
      type: "message",
      role: "assistant",
      model: "deepseek-chat",
      content: [{ type: CLAUDE_BLOCK.TEXT, text: "Answer " + FRAME }],
      stop_reason: CLAUDE_STOP.END_TURN,
      usage: { input_tokens: 3, output_tokens: 2 },
    };
    const result = await handleNonStreamingResponse({
      providerResponse: jsonProviderResponse(claudeMessage),
      provider: "deepseek",
      model: "deepseek-chat",
      finalBody: { model: "deepseek-chat" },
      body: { model: "deepseek-chat", messages: [] },
      stream: false,
      streamToClient: false,
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.CLAUDE,
      requestStartTime: Date.now(),
      connectionId: "conn-1",
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });
    const text = await result.response.text();
    const json = JSON.parse(text);

    expect(text).not.toContain("DSML");
    const calls = clientToolCalls(json, FORMATS.OPENAI);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("lookup");
    expect(calls[0].arguments).toEqual({ word: "hello" });
    expect(json.choices[0].message.content).toBe("Answer ");
    expect(json.choices[0].finish_reason).toBe(OPENAI_FINISH.TOOL_CALLS);
  });
});
