import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const encoder = new TextEncoder();
const credentials = {
  apiKey: "fixture-selected-é門🔐",
  providerSpecificData: { sessionToken: "fixture-session-界🗝" },
};
const publicText = "café 門 🚪 literal /home/fixture/public.txt";
const upstreamError = {
  message: `拒否 café 🚪 ${credentials.apiKey} ${credentials.providerSpecificData.sessionToken} /home/fixture/private.ts:7 Bearer fixture-private-bearer`,
  type: "invalid_request_error",
  code: "context_length_exceeded",
};
const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in UTF-8 stream fixture"); }));
});
afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

async function consume(sourceFormat, wire, targetFormat = FORMATS.OPENAI) {
  const onStreamComplete = vi.fn();
  const onCoherentTerminal = vi.fn();
  const onComplete = vi.fn();
  const onError = vi.fn();
  const streamController = createStreamController({ onComplete, onError });
  const bytes = encoder.encode(wire);
  let offset = 0;
  const providerResponse = new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      // Every 2-, 3-, and 4-byte UTF-8 scalar crosses transport boundaries.
      controller.enqueue(bytes.slice(offset, ++offset));
    },
  }), { headers: { "content-type": "text/event-stream" } });
  let reader;
  let timer;
  try {
    const result = await handleStreamingResponse({
      providerResponse, provider: "openai", model: "gpt-fixture",
      sourceFormat, targetFormat, credentials, streamController,
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: true, requestStartTime: Date.now(), onStreamComplete, onCoherentTerminal,
    });
    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    reader = result.response.body.getReader();
    const drain = async () => {
      const chunks = [];
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
      }
      const output = new TextDecoder("utf-8", { fatal: true }).decode(await new Blob(chunks).arrayBuffer());
      const events = output.split(/\r?\n\r?\n/).flatMap((block) => {
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        return !data || data === "[DONE]" ? [] : [JSON.parse(data)];
      });
      return { output, events, onStreamComplete, onCoherentTerminal, onComplete, onError };
    };
    return await Promise.race([
      drain(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("UTF-8 final Response EOF deadline exceeded")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    streamController.abort("UTF-8 fixture cleanup");
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

function expectSafeError(error) {
  expect(error.message).toContain("拒否 café 🚪");
  expect(error.type).toBe(upstreamError.type);
  expect(error.code).toBe(upstreamError.code);
  const serialized = JSON.stringify(error);
  for (const secret of [credentials.apiKey, credentials.providerSpecificData.sessionToken,
    "/home/fixture/private.ts", "fixture-private-bearer", "�"]) {
    expect.soft(serialized).not.toContain(secret);
  }
}

describe("PR #1276 UTF-8 public stream error boundaries", () => {
  it.each([
    [FORMATS.OPENAI, "\n\n"], [FORMATS.OPENAI, ""],
    [FORMATS.CLAUDE, "\n\n"], [FORMATS.CLAUDE, ""],
    [FORMATS.OPENAI_RESPONSES, "\n\n"], [FORMATS.OPENAI_RESPONSES, ""],
  ])("preserves multibyte content and redacts byte-split %s errors with tail %j", async (format, tail) => {
    const content = frame({
      id: "chatcmpl-utf8-fixture", object: "chat.completion.chunk", created: 1,
      model: "gpt-fixture", choices: [{ index: 0, delta: { content: publicText }, finish_reason: null }],
    });
    const result = await consume(format, content + `data: ${JSON.stringify({ error: upstreamError })}${tail}`);
    const errors = result.events.filter((event) => event.error || event.type === "response.failed");
    expect(errors).toHaveLength(1);
    expectSafeError(errors[0].error || errors[0].response.error);
    const contentText = result.events.map((event) => event.choices?.[0]?.delta?.content ||
      (event.type === "content_block_delta" ? event.delta?.text : "") ||
      (event.type === "response.output_text.delta" ? event.delta : "") || "").join("");
    expect(contentText).toBe(publicText);
    if (format === FORMATS.OPENAI) expect(result.output.startsWith(content)).toBe(true);
    expect(result.output).not.toContain("�");
    expect(result.events.some((event) => event.type === "message_stop" || event.type === "response.completed" ||
      event.choices?.some((choice) => choice.finish_reason))).toBe(false);
    expect(result.onStreamComplete).toHaveBeenCalledTimes(1);
    expect(result.onStreamComplete.mock.calls[0][0].upstreamError).toEqual(upstreamError);
    expect(result.onCoherentTerminal).not.toHaveBeenCalled();
    expect(result.onComplete).toHaveBeenCalledTimes(1);
    expect(result.onError).not.toHaveBeenCalled();
  });

  it.each(["\n\n", ""])("redacts byte-split Claude passthrough error with tail %j", async (tail) => {
    const result = await consume(FORMATS.CLAUDE,
      `event: error\ndata: ${JSON.stringify({ type: "error", error: upstreamError })}${tail}`, FORMATS.CLAUDE);
    expect(result.events.filter((event) => event.type === "error")).toHaveLength(1);
    expectSafeError(result.events[0].error);
    expect(result.onStreamComplete).toHaveBeenCalledTimes(1);
    expect(result.onStreamComplete.mock.calls[0][0].upstreamError).toEqual(upstreamError);
    expect(result.onCoherentTerminal).not.toHaveBeenCalled();
    expect(result.events.some((event) => event.type === "message_stop")).toBe(false);
  });

  it.each([FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES])("preserves ordinary %s passthrough EOF frame bytes", async (format) => {
    const terminal = format === FORMATS.CLAUDE ? { type: "message_stop" } :
      { type: "response.completed", response: { id: "resp-byte-control", status: "completed" } };
    const content = format === FORMATS.CLAUDE ?
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `${publicText} ${credentials.apiKey}` } } :
      { type: "response.output_text.delta", delta: `${publicText} ${credentials.apiKey}` };
    const prefix = `event: ${content.type}\r\ndata: ${JSON.stringify(content)}\r\n\r\nevent: ${terminal.type}\r\n`;
    const tail = `data:   ${JSON.stringify(terminal, null, 0)}  `;
    const result = await consume(format, prefix + tail, format);
    // Existing EOF framing trims trailing whitespace and appends a delimiter; it must not reserialize ordinary JSON.
    expect(result.output.startsWith(prefix + tail.trimEnd() + "\n\n")).toBe(true);
    expect(result.output).toContain(credentials.apiKey);
    expect(result.onStreamComplete).toHaveBeenCalledTimes(1);
    expect(result.onCoherentTerminal).toHaveBeenCalledTimes(1);
  });

  it.each(["\n\n", ""])("redacts byte-split Responses passthrough failure with tail %j", async (tail) => {
    const failure = { type: "response.failed", response: { id: "resp-utf8-fixture", status: "failed", error: upstreamError } };
    const result = await consume(FORMATS.OPENAI_RESPONSES,
      `event: response.failed\ndata: ${JSON.stringify(failure)}${tail}`, FORMATS.OPENAI_RESPONSES);
    const delivered = result.events.find((event) => event.response?.id === failure.response.id);
    expect(delivered).toBeDefined();
    expectSafeError(delivered.response.error);
    expect(result.onStreamComplete).toHaveBeenCalledTimes(1);
    expect(result.onStreamComplete.mock.calls[0][0].upstreamError).toEqual(upstreamError);
    expect(result.onCoherentTerminal).not.toHaveBeenCalled();
  });
});
