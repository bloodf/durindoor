import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  buildOnStreamComplete,
  handleStreamingResponse,
} from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { saveRequestDetail } from "@/lib/usageDb.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

const encoder = new TextEncoder();
const credentials = {
  apiKey: "opaque-provider-e06-7e91",
  accessToken: "opaque-access-e06-4a27",
};
const forbidden = [
  credentials.apiKey,
  credentials.accessToken,
  "/home/fixture/private.ts",
  "fixture-bearer-e06",
  "fixture-e06-stack",
];
const unsafe = `denied ${credentials.apiKey} ${credentials.accessToken} /home/fixture/private.ts:7 Bearer fixture-bearer-e06\n at fixture-e06-stack`;
const safeError = { message: "Request denied", type: "server_error", code: "upstream_denied" };
const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
const doneFrame = "data: [DONE]\n\n";
const contentChunk = {
  id: "chatcmpl-e06-control",
  object: "chat.completion.chunk",
  created: 1,
  model: "gpt-test",
  choices: [{
    index: 0,
    delta: { content: "literal opaque-provider-e06-7e91 /home/fixture/example.ts Bearer fixture-bearer-e06 café" },
    finish_reason: null,
  }],
};
const contentFrame = frame(contentChunk);
let deniedTransport;

beforeEach(() => {
  vi.clearAllMocks();
  deniedTransport = vi.fn(() => { throw new Error("Unexpected transport in finite E-06 fixture"); });
  vi.stubGlobal("fetch", deniedTransport);
  vi.stubGlobal("WebSocket", deniedTransport);
  for (const [module, names] of [
    [http, ["request", "get"]],
    [https, ["request", "get"]],
    [net, ["connect", "createConnection"]],
    [net.Socket.prototype, ["connect"]],
    [net.Server.prototype, ["listen"]],
    [tls, ["connect"]],
    [dns, ["lookup", "resolve"]],
    [dns.promises, ["lookup", "resolve"]],
  ]) {
    for (const name of names) vi.spyOn(module, name).mockImplementation(deniedTransport);
  }
});

afterEach(() => {
  try {
    expect(deniedTransport).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

async function consume(finiteChunks) {
  const body = { messages: [{ role: "user", content: "hello" }] };
  const onRequestSuccess = vi.fn();
  const onTransportComplete = vi.fn();
  const onTransportError = vi.fn();
  const completion = buildOnStreamComplete({
    provider: "openai", model: "gpt-test", connectionId: "fixture-e06",
    requestStartTime: Date.now(), body, stream: true,
    apiKey: "client-usage-e06", onRequestSuccess,
    getProviderAttemptStartedAt: () => 1234, terminalProvenance: "upstream",
  });
  const onStreamComplete = vi.fn(completion.onStreamComplete);
  const onCoherentTerminal = vi.fn(completion.onCoherentTerminal);
  const streamController = createStreamController({
    provider: "openai", model: "gpt-test",
    onComplete: onTransportComplete, onError: onTransportError,
  });
  const providerResponse = new Response(new ReadableStream({
    start(controller) {
      for (const bytes of finiteChunks) controller.enqueue(bytes);
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
  let reader;
  let timer;
  let eof = false;
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("E-06 final Response EOF deadline exceeded")), 1000);
    });
    const drain = async () => {
      const result = await handleStreamingResponse({
        ...completion, providerResponse, provider: "openai", model: "gpt-test",
        sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
        body, stream: true, requestStartTime: Date.now(), connectionId: "fixture-e06",
        credentials, apiKey: "client-usage-e06", streamController,
        onStreamComplete, onCoherentTerminal,
      });
      const finalResponse = result.response;
      expect(finalResponse.status).toBe(200);
      expect(finalResponse.headers.get("content-type")).toContain("text/event-stream");
      // Keep ownership of the reader so deadline cleanup can cancel a locked body.
      reader = finalResponse.body.getReader();
      const chunks = [];
      for (;;) {
        const next = await reader.read();
        if (next.done) { eof = true; break; }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      const wire = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const frames = wire.split(/\r?\n\r?\n/).filter((value) => value.trim());
      const data = frames.map((value) => {
        expect(value.startsWith("data: ")).toBe(true);
        const payload = value.slice(6).trim();
        return payload === "[DONE]" ? payload : JSON.parse(payload);
      });
      return {
        bytes, wire, data, eof, onStreamComplete, onCoherentTerminal,
        onRequestSuccess, onTransportComplete, onTransportError,
        errors: data.filter((value) => value?.error).map((value) => value.error),
        finishes: data.flatMap((value) => value?.choices || []).filter((choice) => choice.finish_reason != null),
        doneCount: data.filter((value) => value === "[DONE]").length,
      };
    };
    return await Promise.race([drain(), deadline]);
  } finally {
    clearTimeout(timer);
    if (!eof) {
      streamController.handleDisconnect("fixture_deadline_or_failure");
      streamController.abort("fixture_deadline_or_failure");
      if (reader) await reader.cancel().catch(() => {});
    }
    reader?.releaseLock();
  }
}

const send = (wire) => consume([encoder.encode(wire)]);

function expectFailure(result, suppliedDone = 0) {
  expect.soft(result.eof, "final Response reaches EOF").toBe(true);
  expect.soft(result.errors, "one public error, no recovery error").toHaveLength(1);
  expect.soft(result.finishes, "no successful finish").toHaveLength(0);
  expect.soft(result.doneCount, "preserve only supplied DONE framing").toBe(suppliedDone);
  expect.soft(result.onCoherentTerminal).not.toHaveBeenCalled();
  expect.soft(result.onRequestSuccess).not.toHaveBeenCalled();
  expect.soft(result.onStreamComplete, "settlement occurs once").toHaveBeenCalledTimes(1);
  expect.soft(result.onStreamComplete.mock.calls[0]?.[0]?.upstreamError, "settlement captures upstreamError").toEqual(expect.objectContaining({ message: expect.any(String) }));
  expect.soft(saveRequestDetail.mock.calls.at(-1)?.[0]?.status, "final persisted detail is error").toBe("error");
  expect.soft(result.onTransportComplete, "clean transport EOF is not semantic success").toHaveBeenCalledTimes(1);
  expect.soft(result.onTransportError).not.toHaveBeenCalled();
}

function expectRedacted(error, field) {
  expect.soft(typeof error?.[field], `public error.${field} remains useful`).toBe("string");
  expect.soft(error?.[field]?.trim().length || 0).toBeGreaterThan(0);
  const errorFields = JSON.stringify(error) || "";
  for (const sentinel of forbidden) {
    expect.soft(errorFields, `error fields redact ${sentinel}`).not.toContain(sentinel);
  }
}

function expectContentBytes(result) {
  const expected = encoder.encode(contentFrame);
  // This ordinary first frame has no fields that existing passthrough normalizes.
  expect(result.bytes.subarray(0, expected.length)).toEqual(expected);
}

describe("OpenAI same-format passthrough error boundaries", () => {
  it("redacts unsafe error.message and preserves safe type/code", async () => {
    const result = await send(frame({ error: { ...safeError, message: unsafe } }));
    expectFailure(result);
    expectRedacted(result.errors[0], "message");
    expect.soft(result.errors[0]?.message).toContain("denied");
    expect.soft(result.errors[0]?.type).toBe(safeError.type);
    expect.soft(result.errors[0]?.code).toBe(safeError.code);
  }, 5000);

  it("redacts unsafe error.type without changing safe message/code", async () => {
    const result = await send(frame({ error: { ...safeError, type: unsafe } }));
    expectFailure(result);
    expectRedacted(result.errors[0], "type");
    expect.soft(result.errors[0]?.message).toBe(safeError.message);
    expect.soft(result.errors[0]?.code).toBe(safeError.code);
  }, 5000);

  it("redacts unsafe error.code without changing safe message/type", async () => {
    const result = await send(frame({ error: { ...safeError, code: unsafe } }));
    expectFailure(result);
    expectRedacted(result.errors[0], "code");
    expect.soft(result.errors[0]?.message).toBe(safeError.message);
    expect.soft(result.errors[0]?.type).toBe(safeError.type);
  }, 5000);

  it("preserves safe content bytes across split upstream chunks before unsafe error", async () => {
    const wire = contentFrame + frame({ error: { ...safeError, message: unsafe } });
    const bytes = encoder.encode(wire);
    const cuts = [
      encoder.encode(wire.slice(0, wire.indexOf("é"))).length + 1,
      encoder.encode(wire.slice(0, wire.lastIndexOf(credentials.apiKey))).length + 9,
    ];
    const result = await consume([bytes.subarray(0, cuts[0]), bytes.subarray(cuts[0], cuts[1]), bytes.subarray(cuts[1])]);
    expectFailure(result);
    expectContentBytes(result);
    expectRedacted(result.errors[0], "message");
    expect.soft(result.errors[0]?.message).toContain("denied");
    expect.soft(result.errors[0]?.type).toBe(safeError.type);
    expect.soft(result.errors[0]?.code).toBe(safeError.code);
  }, 5000);

  it("preserves safe upstream error fields", async () => {
    const result = await send(frame({ error: safeError }));
    expectFailure(result);
    expect(result.errors[0]).toEqual(safeError);
  }, 5000);

  it("does not turn upstream error plus DONE into success", async () => {
    const result = await send(frame({ error: safeError }) + doneFrame);
    expectFailure(result, 1);
    expect(result.errors[0]).toEqual(safeError);
  }, 5000);

  it("handles unsafe final error without newline at EOF", async () => {
    const result = await send(`data: ${JSON.stringify({ error: { ...safeError, message: unsafe } })}`);
    expectFailure(result);
    expect.soft(result.wire, "EOF error is a complete SSE frame").toMatch(/\r?\n\r?\n$/);
    expectRedacted(result.errors[0], "message");
    expect.soft(result.errors[0]?.message).toContain("denied");
    expect.soft(result.errors[0]?.type).toBe(safeError.type);
    expect.soft(result.errors[0]?.code).toBe(safeError.code);
  }, 5000);

  it("retains normal OpenAI success and content bytes", async () => {
    const finish = { ...contentChunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
    const result = await send(contentFrame + frame(finish) + doneFrame);
    expectContentBytes(result);
    expect(result.eof).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.finishes).toHaveLength(1);
    expect(result.finishes[0].finish_reason).toBe("stop");
    expect(result.doneCount).toBe(1);
    expect(result.onCoherentTerminal).toHaveBeenCalledTimes(1);
    expect(result.onRequestSuccess).toHaveBeenCalledTimes(1);
    expect(result.onRequestSuccess).toHaveBeenCalledWith({ attemptStartedAt: 1234 });
    expect(result.onStreamComplete).toHaveBeenCalledTimes(1);
    expect(result.onStreamComplete.mock.calls[0][0]?.upstreamError).toBeFalsy();
    expect(saveRequestDetail.mock.calls.at(-1)?.[0]?.status).toBe("success");
    expect(result.onTransportComplete).toHaveBeenCalledTimes(1);
    expect(result.onTransportError).not.toHaveBeenCalled();
  }, 5000);
});
