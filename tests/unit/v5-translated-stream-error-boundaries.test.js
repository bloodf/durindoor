import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  buildOnStreamComplete,
  handleStreamingResponse,
} from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { appendRequestLog, saveRequestDetail, saveRequestUsage } from "@/lib/usageDb.js";

// Only persistence is replaced; completion, translation, framing, and terminal
// tracking run through the real handler and its final client Response.
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

const formats = [FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES];
const encoder = new TextEncoder();
const diagnosticError = {
  message: "denied opaque-e06-selected opaque-e06-session /home/e06/private.ts:7 Bearer e06-bearer\n    at e06Stack (/opt/e06/source.js:4:2)",
  type: "invalid_request_error",
  code: "context_length_exceeded",
};
const forbidden = [
  "opaque-e06-selected", "opaque-e06-session", "e06-bearer", "e06-code",
  "/home/e06/", "/opt/e06/", "e06Stack",
];
const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
const content = (text) => ({
  choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
});
const finish = () => frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });

function barrier() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function parseEvents(wire) {
  const events = [];
  let doneCount = 0;
  for (const block of wire.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const data = lines.filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) continue;
    if (data === "[DONE]") {
      doneCount += 1;
      continue;
    }
    events.push({
      event: lines.find((line) => line.startsWith("event:"))?.slice(6).trim(),
      payload: JSON.parse(data),
    });
  }
  // DONE is a delimiter, not a semantic success event. Do not certify Claude
  // protocol compliance or pin generated Responses identifiers/sequence values.
  return { events, doneCount };
}

let fetchGuard;
beforeEach(() => {
  vi.clearAllMocks();
  fetchGuard = vi.fn(() => { throw new Error("Network forbidden in translated stream fixture"); });
  vi.stubGlobal("fetch", fetchGuard);
});
afterEach(() => {
  try {
    expect(fetchGuard).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

async function runStream(sourceFormat, chunks) {
  const completed = barrier();
  const transportEnded = barrier();
  const onRequestSuccess = vi.fn();
  const onEmptyStream = vi.fn();
  const body = { messages: [{ role: "user", content: "hello" }] };
  const common = {
    provider: "openai",
    model: "gpt-test",
    connectionId: "e06-connection",
    apiKey: "e06-caller-usage-key",
    requestStartTime: Date.now(),
    body,
    stream: true,
  };
  const completion = buildOnStreamComplete({
    ...common,
    onRequestSuccess,
    onEmptyStream,
    getProviderAttemptStartedAt: () => 1234,
    terminalProvenance: "upstream",
  });
  const onStreamComplete = vi.fn((...args) => {
    try {
      return completion.onStreamComplete(...args);
    } finally {
      completed.resolve();
    }
  });
  const streamController = createStreamController({
    provider: common.provider,
    model: common.model,
    onComplete: transportEnded.resolve,
    onError: transportEnded.resolve,
    onDisconnect: transportEnded.resolve,
  });
  const upstream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  let reader;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      streamController.abort("translated fixture deadline");
      void reader?.cancel("translated fixture deadline").catch(() => {});
      reject(new Error("Translated final Response did not reach EOF and completion within 2000ms"));
    }, 2000);
  });
  try {
    return await Promise.race([
      (async () => {
        const result = await handleStreamingResponse({
          ...common,
          ...completion,
          onStreamComplete,
          sourceFormat,
          targetFormat: FORMATS.OPENAI,
          credentials: {
            apiKey: "opaque-e06-selected",
            providerSpecificData: { sessionToken: "opaque-e06-session" },
          },
          streamController,
          providerResponse: new Response(upstream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        });
        expect(result.success).toBe(true);
        expect(result.response.status).toBe(200);
        expect(result.response.headers.get("content-type")).toContain("text/event-stream");
        reader = result.response.body.getReader();
        const decoder = new TextDecoder();
        let wire = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          wire += decoder.decode(value, { stream: true });
        }
        wire += decoder.decode();
        await Promise.all([completed.promise, transportEnded.promise]);
        // Await the actual persistence seam promises, not a sleep or an assumed
        // number of microtasks. EOF also follows upstream terminal finalization.
        await Promise.all([appendRequestLog, saveRequestDetail, saveRequestUsage]
          .flatMap((mock) => mock.mock.results.map((entry) => entry.value)));
        return {
          wire,
          ...parseEvents(wire),
          onRequestSuccess,
          onEmptyStream,
          onStreamComplete,
          detail: saveRequestDetail.mock.calls.at(-1)?.[0],
        };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    streamController.abort("translated fixture cleanup");
    if (reader) {
      // Cancellation reaches disconnect-aware piping even when an assertion or
      // deadline fails; do not leave the client stream or watchdog running.
      void reader.cancel("translated fixture cleanup").catch(() => {});
      reader.releaseLock();
    }
  }
}

function failures(result) {
  return result.events.filter(({ payload }) => payload.type === "error" || payload.type === "response.failed");
}

function successes(result) {
  return result.events.filter(({ payload }) => payload.type === "message_stop" || payload.type === "response.completed");
}

function publicContent(result, format) {
  return result.events.map(({ payload }) => {
    if (format === FORMATS.CLAUDE && payload.type === "content_block_delta" && payload.delta?.type === "text_delta") {
      return payload.delta.text;
    }
    if (format === FORMATS.OPENAI_RESPONSES && payload.type === "response.output_text.delta") {
      return payload.delta;
    }
    return "";
  }).join("");
}

function expectFailure(result, format, upstreamError, requestScoped = true) {
  expect(result.onStreamComplete).toHaveBeenCalledTimes(1);
  expect(result.onStreamComplete.mock.calls[0][0].upstreamError).toEqual(upstreamError);
  expect(result.onRequestSuccess).not.toHaveBeenCalled();
  expect(result.detail.status).toBe("error");
  expect(result.detail.response.error).toEqual(upstreamError);
  if (requestScoped) expect(result.onEmptyStream).not.toHaveBeenCalled();
  expect(successes(result)).toEqual([]);
  const failed = failures(result);
  expect(failed).toHaveLength(1);
  const expectedType = format === FORMATS.CLAUDE ? "error" : "response.failed";
  expect(failed[0].event).toBe(expectedType);
  expect(failed[0].payload.type).toBe(expectedType);
  expect(result.doneCount).toBeLessThanOrEqual(1);
  if (format === FORMATS.OPENAI_RESPONSES) {
    expect(failed[0].payload.response.status).toBe("failed");
    expect(failed[0].payload.response.output).toEqual([]);
    return failed[0].payload.response.error;
  }
  return failed[0].payload.error;
}

function expectSafe(wire, error) {
  for (const token of forbidden) {
    expect(wire).not.toContain(token);
    for (const field of ["message", "type", "code"]) {
      expect(typeof error[field]).toBe("string");
      expect(error[field]).not.toContain(token);
    }
  }
  // The canonical sanitizer emits "Bearer [redacted]"; only an unredacted Bearer value is a leak.
  const unredactedBearer = /Bearer\s+(?!\[redacted\])\S/;
  expect(wire).not.toMatch(unredactedBearer);
  for (const field of ["message", "type", "code"]) expect(error[field]).not.toMatch(unredactedBearer);
}

describe("translated stream error boundaries through the final Response", () => {
  it.each(formats)("redacts selected credentials and diagnostics from translated %s message", async (format) => {
    const result = await runStream(format, [frame({ error: diagnosticError })]);
    const error = expectFailure(result, format, diagnosticError);
    expect(error.message).toContain("denied");
    expect(error.type).toBe(diagnosticError.type);
    expect(error.code).toBe(diagnosticError.code);
    expectSafe(result.wire, error);
  });

  it.each(formats)("redacts translated %s type and code without dropping safe message", async (format) => {
    const upstreamError = {
      message: "request rejected",
      type: "invalid opaque-e06-selected /home/e06/type.ts:1",
      code: "denied opaque-e06-session Bearer e06-code",
    };
    const result = await runStream(format, [frame({ error: upstreamError })]);
    const error = expectFailure(result, format, upstreamError, false);
    expect(error.message).toBe("request rejected");
    expectSafe(result.wire, error);
  });

  it.each(formats)("preserves translated %s context refusal and emits only one failure", async (format) => {
    const upstreamError = {
      message: "Prompt is too long",
      type: "invalid_request_error",
      code: "context_length_exceeded",
    };
    const result = await runStream(format, [
      frame({ error: upstreamError }),
      frame({ error: { ...upstreamError, message: "duplicate error must not replace first" } }),
      frame(content("post-error-content-marker")),
      finish(),
      "data: [DONE]\n\n",
    ]);
    expect(expectFailure(result, format, upstreamError)).toEqual(upstreamError);
    expect(result.wire).not.toContain("post-error-content-marker");
    expect(result.wire).not.toContain("duplicate error must not replace first");
  });

  it.each(formats)("retains a split final translated %s error without trailing newline", async (format) => {
    const tail = encoder.encode(`data: ${JSON.stringify({ error: diagnosticError })}`);
    const splitAt = encoder.encode(`data: ${JSON.stringify({ error: diagnosticError })}`.split("opaque-e06-selected")[0] + "opaque-e06-").length;
    const result = await runStream(format, [
      frame(content("partial")),
      tail.slice(0, splitAt),
      tail.slice(splitAt),
    ]);
    expect(publicContent(result, format)).toBe("partial");
    const error = expectFailure(result, format, diagnosticError);
    expect(error.message).toContain("denied");
    expect(error.type).toBe(diagnosticError.type);
    expect(error.code).toBe(diagnosticError.code);
    expectSafe(result.wire, error);
  });

  it.each(formats)("preserves successful translated %s content and clears once", async (format) => {
    const result = await runStream(format, [
      frame(content("/home/e06/user.txt")), finish(), "data: [DONE]\n\n",
    ]);
    expect(publicContent(result, format)).toBe("/home/e06/user.txt");
    expect(failures(result)).toEqual([]);
    const completed = successes(result);
    expect(completed).toHaveLength(1);
    const expectedType = format === FORMATS.CLAUDE ? "message_stop" : "response.completed";
    expect(completed[0].event).toBe(expectedType);
    expect(completed[0].payload.type).toBe(expectedType);
    expect(result.onRequestSuccess).toHaveBeenCalledTimes(1);
    expect(result.onRequestSuccess).toHaveBeenCalledWith({ attemptStartedAt: 1234 });
    expect(result.onStreamComplete).toHaveBeenCalledTimes(1);
    expect(result.onStreamComplete.mock.calls[0][0].upstreamError).toBeUndefined();
    expect(result.detail.status).toBe("success");
    expect(result.onEmptyStream).not.toHaveBeenCalled();
    expect(result.doneCount).toBeLessThanOrEqual(1);
  });
});
