// #1073 / OmniRoute #18468 (head 3b3c7dd0): Chat Completions heartbeats must not
// create an application choice that splits or drops streamed tool-call fragments.
// DurinDoor has no such frame: the Chat route has no early wrapper and the
// ongoing keepalive is selected only for emitted Claude format. These tests pin
// that, plus identity, accumulated arguments and EOF for a strict offline client.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createStreamController, createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(),
  initTranslators: vi.fn(async () => undefined),
}));

vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "test-agent",
  updateKimchiUserAgent: vi.fn(async () => "test-agent"),
}));
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("open-sse/translator/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  initTranslators: mocks.initTranslators,
}));

const { POST: chatPost } = await import("../../src/app/api/v1/chat/completions/route.js");
const { POST: responsesPost } = await import("../../src/app/api/v1/responses/route.js");

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const root = new URL("../../", import.meta.url);

const chunk = (delta, finish_reason = null) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-real",
    object: "chat.completion.chunk",
    created: 42,
    model: "real-model",
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`;

const FRAGMENTS = [
  chunk({ role: "assistant" }),
  chunk({ tool_calls: [{ index: 0, id: "call-real", type: "function", function: { name: "get_self", arguments: "" } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: '{"reason":' } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: '"ready"}' } }] }),
  chunk({}, "tool_calls"),
];
const DONE = "data: [DONE]\n\n";

function hangingBody() {
  let controller;
  return {
    body: new ReadableStream({ start(value) { controller = value; } }),
    enqueue: (text) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

async function settledRead(readPromise) {
  let result;
  readPromise.then((value) => { result = value; });
  await Promise.resolve();
  return result;
}

async function drain(reader) {
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value);
  }
}

// Same drain, but it also reports that the stream really reached EOF, so a
// caller can assert termination instead of inferring it from the bytes.
async function drainToEof(reader) {
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return { text, eof: true };
    text += decoder.decode(value);
  }
}

// What a strict offline Chat client does: every non-empty SSE line must be a
// `data:` JSON object or [DONE]; tool calls aggregate by index. The frame list
// keeps wire order, so a caller can assert *where* [DONE] and the finish frame
// sit instead of only that they exist somewhere.
function strictParse(text) {
  const payloads = [];
  const frames = [];
  let sawDone = false;
  for (const entry of text.split("\n\n").filter(Boolean)) {
    expect(entry, "strict clients must not see SSE comments or events").toMatch(/^data: /);
    const data = entry.slice(6);
    if (data === "[DONE]") { sawDone = true; frames.push({ kind: "done" }); continue; }
    const payload = JSON.parse(data);
    payloads.push(payload);
    frames.push({ kind: "data", payload });
  }
  const calls = new Map();
  for (const payload of payloads) {
    for (const choice of payload.choices) {
      for (const call of choice.delta?.tool_calls || []) {
        const slot = calls.get(call.index) || { id: null, name: null, args: "" };
        slot.id = call.id ?? slot.id;
        slot.name = call.function?.name ?? slot.name;
        slot.args += call.function?.arguments ?? "";
        calls.set(call.index, slot);
      }
    }
  }
  return { payloads, calls: [...calls.values()], sawDone, frames };
}

function chatRequest() {
  return new Request("https://router.test/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "m", messages: [], stream: true }),
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("#1073 Chat Completions heartbeats and tool fragments", () => {
  it("startup: a slow /v1/chat/completions handler gets no early frame, so the first choice stays upstream-owned", async () => {
    vi.useFakeTimers();
    let resolve;
    mocks.handleChat.mockReturnValue(new Promise((done) => { resolve = done; }));

    const responsePromise = chatPost(chatRequest());
    await vi.advanceTimersByTimeAsync(30_000);
    // No wrapper: the route returns nothing (let alone a heartbeat) until handleChat settles.
    expect(await settledRead(responsePromise)).toBeUndefined();

    const upstream = new Response(FRAGMENTS.join("") + DONE, { headers: { "content-type": "text/event-stream" } });
    resolve(upstream);
    const response = await responsePromise;
    // The route adds only correlation headers; status, type and bytes stay the handler's.
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const body = await drain(response.body.getReader());
    expect(body).toBe(FRAGMENTS.join("") + DONE);
  });

  it("ongoing: no heartbeat is emitted for OpenAI-emitted chat streams, before or between tool fragments", async () => {
    vi.useFakeTimers();
    const upstream = hangingBody();
    const result = await handleStreamingResponse({
      providerResponse: new Response(upstream.body, { headers: { "content-type": "text/event-stream" } }),
      provider: "test-provider",
      model: "test-model",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { stream: true, messages: [] },
      stream: true,
      requestStartTime: Date.now(),
      connectionId: "test-connection",
      streamController: createStreamController({ provider: "test", model: "test", log: { line: vi.fn() } }),
    });
    const reader = result.response.body.getReader();

    // Silence before the first fragment: nothing, not even an empty-choices chunk.
    const first = reader.read();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await settledRead(first)).toBeUndefined();

    let out = "";
    const pump = async (readPromise) => { const { value } = await readPromise; out += decoder.decode(value); };
    upstream.enqueue(FRAGMENTS[0]);
    await pump(first);
    for (const fragment of FRAGMENTS.slice(1, 4)) {
      // Silence between fragments: still nothing injected.
      const next = reader.read();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await settledRead(next)).toBeUndefined();
      upstream.enqueue(fragment);
      await pump(next);
    }
    upstream.enqueue(FRAGMENTS[4] + DONE);
    upstream.close();
    const tail = await drainToEof(reader);
    out += tail.text;

    const { payloads, calls, sawDone, frames } = strictParse(out);
    expect(sawDone).toBe(true); // EOF behavior: terminal [DONE], then the stream closes.
    expect(payloads.every((p) => p.choices.length === 1)).toBe(true);
    expect(calls).toEqual([{ id: "call-real", name: "get_self", args: '{"reason":"ready"}' }]);
    expect(new Set(payloads.map((p) => p.id)).size).toBe(1);
    expect(payloads.every((p) => p.id !== "chatcmpl-keepalive")).toBe(true);

    // Terminal order, not just terminal presence: exactly one finish frame, it
    // comes after the last argument fragment, exactly one [DONE] comes after
    // that finish frame, and no frame at all follows [DONE].
    const dataFrames = frames.filter((frame) => frame.kind === "data");
    const finishFrames = dataFrames.filter((frame) => frame.payload.choices?.[0]?.finish_reason != null);
    expect(finishFrames).toHaveLength(1);
    expect(finishFrames[0].payload.choices[0].finish_reason).toBe("tool_calls");
    const argumentFrames = dataFrames.filter((frame) =>
      (frame.payload.choices?.[0]?.delta?.tool_calls || []).some((call) => call.function?.arguments !== undefined));
    expect(argumentFrames.length).toBeGreaterThan(0);
    const lastArgumentIndex = frames.indexOf(argumentFrames[argumentFrames.length - 1]);
    const finishIndex = frames.indexOf(finishFrames[0]);
    expect(finishIndex).toBeGreaterThan(lastArgumentIndex);
    const doneFrames = frames.filter((frame) => frame.kind === "done");
    expect(doneFrames).toHaveLength(1);
    const doneIndex = frames.indexOf(doneFrames[0]);
    expect(doneIndex).toBeGreaterThan(finishIndex);
    expect(frames.slice(doneIndex + 1)).toHaveLength(0);
    // Byte level: [DONE] is the last thing on the wire, with nothing behind it.
    expect(out.slice(out.indexOf(DONE) + DONE.length)).toBe("");
    expect(finishIndex).toBe(dataFrames.length - 1); // the finish frame is the last data frame

    // Actual EOF: the client stream ended, and a further read reports the end
    // of the stream instead of another frame.
    expect(tail.eof).toBe(true);
    const afterEof = await reader.read();
    expect(afterEof.done).toBe(true);
    expect(afterEof.value).toBeUndefined();
  });

  it("transport layer: a null keepalive frame leaves tool fragments byte-identical with EOF", async () => {
    vi.useFakeTimers();
    const source = hangingBody();
    const reader = createDisconnectAwareStream(
      { readable: source.body },
      createStreamController({ provider: "test", model: "test", log: { line: vi.fn() } }),
      null, null, null, null, null,
      null, 1_000,
    ).getReader();

    const first = reader.read();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await settledRead(first)).toBeUndefined();
    source.enqueue(FRAGMENTS.join("") + DONE);
    source.close();
    const body = decoder.decode((await first).value) + await drain(reader);
    expect(body).toBe(FRAGMENTS.join("") + DONE);
  });

  it("existing comment keepalive is Responses-only and never reaches a Chat route", async () => {
    vi.useFakeTimers();
    let resolve;
    mocks.handleChat.mockReturnValue(new Promise((done) => { resolve = done; }));
    const request = new Request("https://router.test/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", input: "x", stream: true }),
    });
    const responsePromise = responsesPost(request);
    await vi.advanceTimersByTimeAsync(2_000);
    const reader = (await responsePromise).body.getReader();
    // Native Responses clients consume SSE comments; that behavior is unchanged here.
    expect(decoder.decode((await reader.read()).value)).toBe(": keepalive\n\n");
    resolve(new Response(DONE, { headers: { "content-type": "text/event-stream" } }));
    expect(decoder.decode((await reader.read()).value)).toBe(DONE);

    // The Chat-family routes do not import the wrapper, so no comment can leak into Chat streams.
    for (const path of [
      "src/app/api/v1/chat/completions/route.js",
      "src/app/api/v1/completions/route.js",
      "src/app/api/v1/api/chat/route.js",
    ]) {
      expect(readFileSync(new URL(path, root), "utf8"), path).not.toMatch(/earlyStreamKeepalive|withEarlyStreamKeepalive/);
    }
  });

  it("only the Claude emitted format selects an ongoing keepalive frame", () => {
    const source = readFileSync(new URL("open-sse/handlers/chatCore/streamingHandler.js", root), "utf8");
    expect(source).toMatch(/const keepaliveFrame = emittedFormat === FORMATS\.CLAUDE \? ANTHROPIC_PING_FRAME : null;/);
    const early = readFileSync(new URL("open-sse/utils/earlyStreamKeepalive.js", root), "utf8");
    // No Chat-shaped empty-choice or empty-delta keepalive constant exists to adapt.
    expect(early).not.toMatch(/OPENAI_KEEPALIVE_FRAME|OPENAI_STARTUP_FRAME|chatcmpl-keepalive/);
  });
});
