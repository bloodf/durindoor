// OmniRoute #18377: a forced-streaming upstream can answer a non-streaming
// client with one complete JSON response document (chat completion, Responses
// object, Claude message or a structured error) labelled `text/event-stream`,
// sometimes with `data: [DONE]` glued after the closing brace. No line of it is
// a `data:` frame, so the buffered event-stream parsers found nothing and the
// request failed as an invalid event stream. The document must be read as the
// non-stream response it is; genuinely corrupt event streams keep the 502.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { parseJsonDocumentBehindEventStream } from "../../open-sse/handlers/chatCore/nonStreamingJsonDocument.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { saveUsageStats, saveRequestUsage } from "@/lib/usageDb.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  saveUsageStats: vi.fn(async () => {}),
  extractRequestConfig: vi.fn(() => ({})),
  buildRequestDetail: vi.fn((args) => args),
  formatDoneLine: vi.fn(() => "done"),
}));

const INVALID_SSE = "Invalid SSE response for non-streaming request";

const CHAT_DOC = {
  id: "chatcmpl-doc",
  object: "chat.completion",
  created: 1700000000,
  model: "deepseek-v4.1-flash",
  choices: [{
    index: 0,
    finish_reason: "stop",
    message: { role: "assistant", content: "documented answer" },
  }],
  usage: { prompt_tokens: 404, completion_tokens: 2, total_tokens: 406 },
};

const RESPONSES_DOC = {
  id: "resp_doc",
  object: "response",
  status: "completed",
  model: "gpt-5.6-sol",
  output: [{
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "documented answer" }],
  }],
  usage: { input_tokens: 404, output_tokens: 2, total_tokens: 406 },
};

const CLAUDE_DOC = {
  id: "msg_doc",
  type: "message",
  role: "assistant",
  model: "claude-x",
  content: [{ type: "text", text: "documented answer" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 404, output_tokens: 2 },
};

/** A provider response whose media type says event-stream but whose body is JSON. */
function eventStreamMediaType(body) {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A body that can be consumed exactly once: a second read throws. */
function singleReadResponse(body) {
  const encoder = new TextEncoder();
  let reads = 0;
  const stream = new ReadableStream({
    pull(controller) {
      reads++;
      if (reads > 1) throw new Error("provider body read twice");
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function nonStreamingOptions(providerResponse, overrides = {}) {
  return {
    providerResponse,
    provider: "openai",
    model: "test-model",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { messages: [{ role: "user", content: "hello" }] },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "connection-18377",
    onRequestSuccess: vi.fn(async () => {}),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    terminalProvenance: "upstream",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    ...overrides,
  };
}

function forcedOptions(providerResponse, overrides = {}) {
  return {
    providerResponse,
    provider: "openai",
    model: "test-model",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { messages: [{ role: "user", content: "hello" }] },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "connection-18377",
    onRequestSuccess: vi.fn(async () => {}),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    log: { line: vi.fn(), debug: vi.fn() },
    terminalProvenance: "upstream",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("parseJsonDocumentBehindEventStream", () => {
  it("recognises the supported response documents", () => {
    expect(parseJsonDocumentBehindEventStream(JSON.stringify(CHAT_DOC), FORMATS.OPENAI))
      .toEqual({ body: CHAT_DOC, format: FORMATS.OPENAI });
    expect(parseJsonDocumentBehindEventStream(JSON.stringify(RESPONSES_DOC), FORMATS.OPENAI))
      .toEqual({ body: RESPONSES_DOC, format: FORMATS.OPENAI_RESPONSES });
    expect(parseJsonDocumentBehindEventStream(JSON.stringify(CLAUDE_DOC), FORMATS.OPENAI))
      .toEqual({ body: CLAUDE_DOC, format: FORMATS.CLAUDE });
  });

  it("recognises a structured error envelope", () => {
    const doc = { error: { message: "Rate limit reached", status: 429 } };
    expect(parseJsonDocumentBehindEventStream(JSON.stringify(doc), FORMATS.OPENAI))
      .toEqual({ body: doc, format: FORMATS.OPENAI });
  });

  it("strips a glued data: [DONE] sentinel", () => {
    const doc = { ...CHAT_DOC };
    expect(parseJsonDocumentBehindEventStream(`${JSON.stringify(doc)}data: [DONE]\n\n`, FORMATS.OPENAI))
      .toEqual({ body: doc, format: FORMATS.OPENAI });
  });

  it.each([
    ["truncated JSON document", JSON.stringify(CHAT_DOC).slice(0, 60)],
    ["an object that is not a response", '{"foo":"bar"}'],
    ["a bare chunk without data: framing", '{"choices":[{"index":0,"delta":{"content":"hi"}}]}'],
    ["a document followed by garbage", `${JSON.stringify(CHAT_DOC)}\ngarbage`],
    ["an unparseable frame", "data: not-json-at-all\n\n"],
    ["a JSON array", "[1,2,3]"],
    ["an empty body", ""],
  ])("rejects %s", (_label, body) => {
    expect(parseJsonDocumentBehindEventStream(body, FORMATS.OPENAI)).toBeNull();
  });
});

describe("non-streaming route: a complete JSON document under the event-stream media type", () => {
  it.each([
    ["a bare document", JSON.stringify(CHAT_DOC)],
    ["a document with a glued data: [DONE]", `${JSON.stringify(CHAT_DOC)}data: [DONE]\n\n`],
    ["a document followed by a data: [DONE] frame", `${JSON.stringify(CHAT_DOC)}\n\ndata: [DONE]\n\n`],
    ["a pretty-printed document", `\n${JSON.stringify(CHAT_DOC, null, 2)}\n`],
  ])("serves %s as the non-stream response", async (_label, body) => {
    const providerResponse = eventStreamMediaType(body);
    // The mismatch is real and verified: the media type says event-stream, the
    // body opens with the JSON document instead of an event-stream frame.
    expect(providerResponse.headers.get("content-type")).toBe("text/event-stream");
    expect(body.trimStart().startsWith("{")).toBe(true);

    const options = nonStreamingOptions(providerResponse);
    const result = await handleNonStreamingResponse(options);

    expect(result.success).toBe(true);
    const clientBody = await result.response.json();
    expect(clientBody.choices[0].message.content).toBe("documented answer");
    expect(clientBody.usage.completion_tokens).toBe(2);
    expect(clientBody.usage.total_tokens).toBe(clientBody.usage.prompt_tokens + 2);
    expect(options.onRequestSuccess).toHaveBeenCalledOnce();
    expect(saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      tokens: expect.objectContaining({ prompt_tokens: 404, completion_tokens: 2 }),
    }));
  });

  it("reads the provider body exactly once", async () => {
    const result = await handleNonStreamingResponse(
      nonStreamingOptions(singleReadResponse(JSON.stringify(CHAT_DOC)))
    );
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("documented answer");
  });

  it("serves a Responses document to a Responses client", async () => {
    const result = await handleNonStreamingResponse(nonStreamingOptions(
      eventStreamMediaType(JSON.stringify(RESPONSES_DOC)),
      { sourceFormat: FORMATS.OPENAI_RESPONSES, targetFormat: FORMATS.OPENAI_RESPONSES }
    ));
    expect(result.success).toBe(true);
    const clientBody = await result.response.json();
    expect(clientBody.object).toBe("response");
    expect(clientBody.output[0].content[0].text).toBe("documented answer");
  });

  it("serves a Claude message document to a Claude client", async () => {
    const result = await handleNonStreamingResponse(nonStreamingOptions(
      eventStreamMediaType(JSON.stringify(CLAUDE_DOC)),
      { sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.CLAUDE }
    ));
    expect(result.success).toBe(true);
    const clientBody = await result.response.json();
    expect(clientBody.type).toBe("message");
    expect(clientBody.content[0].text).toBe("documented answer");
    expect(clientBody.stop_reason).toBe("end_turn");
  });

  it("serves a Claude message document to a chat client", async () => {
    const result = await handleNonStreamingResponse(nonStreamingOptions(
      eventStreamMediaType(JSON.stringify(CLAUDE_DOC)),
      { sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.CLAUDE }
    ));
    expect(result.success).toBe(true);
    const clientBody = await result.response.json();
    expect(clientBody.choices[0].message.content).toBe("documented answer");
  });

  it("keeps the error envelope an error instead of a success", async () => {
    const options = nonStreamingOptions(eventStreamMediaType(JSON.stringify({
      error: { message: "Rate limit reached", status: 429 },
    })));
    const result = await handleNonStreamingResponse(options);
    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toBe("Rate limit reached");
    expect(options.onRequestSuccess).not.toHaveBeenCalled();
    expect(saveUsageStats).not.toHaveBeenCalled();
  });

  it("keeps real event streams on the event-stream path", async () => {
    const sse = `data: ${JSON.stringify({ id: "sse", model: "test-model", choices: [{ index: 0, delta: { content: "streamed answer" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
    const result = await handleNonStreamingResponse(nonStreamingOptions(eventStreamMediaType(sse)));
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("streamed answer");
  });

  it.each([
    ["a truncated document", JSON.stringify(CHAT_DOC).slice(0, 60)],
    ["an object that is not a response", '{"foo":"bar"}'],
    ["a bare chunk without data: framing", '{"choices":[{"index":0,"delta":{"content":"hi"}}]}'],
    ["a document followed by garbage", `${JSON.stringify(CHAT_DOC)}\ngarbage`],
  ])("still fails %s as an invalid event stream", async (_label, body) => {
    const options = nonStreamingOptions(eventStreamMediaType(body));
    const result = await handleNonStreamingResponse(options);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toBe(INVALID_SSE);
    expect(options.onRequestSuccess).not.toHaveBeenCalled();
    expect(saveUsageStats).not.toHaveBeenCalled();
  });

  it("synthesises client SSE from the document when the client asked for a stream", async () => {
    const result = await handleNonStreamingResponse(nonStreamingOptions(
      eventStreamMediaType(JSON.stringify(CHAT_DOC)),
      { streamToClient: true }
    ));
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toBe("text/event-stream");
    expect(await result.response.text()).toContain("documented answer");
  });

  it.each([
    ["a Claude message", CLAUDE_DOC, { sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.CLAUDE }],
    ["a Responses object", RESPONSES_DOC, { sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI_RESPONSES }],
  ])("synthesises client SSE from %s", async (_label, doc, formats) => {
    const result = await handleNonStreamingResponse(nonStreamingOptions(
      eventStreamMediaType(JSON.stringify(doc)),
      { streamToClient: true, ...formats }
    ));
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toBe("text/event-stream");
    expect(await result.response.text()).toContain("documented answer");
  });

  it("still reports an aborted request as aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const options = nonStreamingOptions(eventStreamMediaType(JSON.stringify(CHAT_DOC)), { signal: controller.signal });
    const result = await handleNonStreamingResponse(options);
    expect(result.success).toBe(false);
    expect(result.status).toBe(499);
    expect(options.onRequestSuccess).not.toHaveBeenCalled();
  });
});

describe("forced-streaming route: a complete JSON document under the event-stream media type", () => {
  it("serves a chat completion document as the non-stream response", async () => {
    const options = forcedOptions(eventStreamMediaType(JSON.stringify(CHAT_DOC)));
    const result = await handleForcedSSEToJson(options);
    expect(result.success).toBe(true);
    const clientBody = await result.response.json();
    expect(clientBody.choices[0].message.content).toBe("documented answer");
    expect(clientBody.usage.completion_tokens).toBe(2);
    expect(options.onRequestSuccess).toHaveBeenCalledOnce();
  });

  it("serves a Responses document to a Responses client", async () => {
    const options = forcedOptions(eventStreamMediaType(JSON.stringify(RESPONSES_DOC)), {
      provider: "codex",
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
    });
    const result = await handleForcedSSEToJson(options);
    expect(result.success).toBe(true);
    const clientBody = await result.response.json();
    expect(clientBody.object).toBe("response");
    expect(clientBody.output[0].content[0].text).toBe("documented answer");
  });

  it("serves a Responses document to a chat client", async () => {
    const options = forcedOptions(eventStreamMediaType(JSON.stringify(RESPONSES_DOC)), {
      provider: "codex",
      targetFormat: FORMATS.OPENAI_RESPONSES,
    });
    const result = await handleForcedSSEToJson(options);
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("documented answer");
  });

  it("serves a Claude message document to a chat client", async () => {
    const options = forcedOptions(eventStreamMediaType(JSON.stringify(CLAUDE_DOC)), {
      targetFormat: FORMATS.CLAUDE,
    });
    const result = await handleForcedSSEToJson(options);
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("documented answer");
  });

  it("keeps the error envelope an error instead of a success", async () => {
    const options = forcedOptions(eventStreamMediaType(JSON.stringify({
      error: { message: "Rate limit reached", status: 429 },
    })));
    const result = await handleForcedSSEToJson(options);
    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toBe("Rate limit reached");
    expect(options.onRequestSuccess).not.toHaveBeenCalled();
    expect(saveUsageStats).not.toHaveBeenCalled();
  });

  it.each([
    ["a truncated document", JSON.stringify(CHAT_DOC).slice(0, 60)],
    ["an object that is not a response", '{"foo":"bar"}'],
    ["a document followed by garbage", `${JSON.stringify(CHAT_DOC)}\ngarbage`],
  ])("still fails %s as an invalid event stream", async (_label, body) => {
    const options = forcedOptions(eventStreamMediaType(body));
    const result = await handleForcedSSEToJson(options);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toBe(INVALID_SSE);
    expect(options.onRequestSuccess).not.toHaveBeenCalled();
    expect(saveUsageStats).not.toHaveBeenCalled();
  });

  it("keeps real event streams on the event-stream path", async () => {
    const sse = `data: ${JSON.stringify({ id: "sse", model: "test-model", choices: [{ index: 0, delta: { content: "streamed answer" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
    const result = await handleForcedSSEToJson(forcedOptions(eventStreamMediaType(sse)));
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("streamed answer");
  });
});
