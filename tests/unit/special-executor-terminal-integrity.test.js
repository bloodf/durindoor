import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import "../translator/registerAll.js";
import { KiroExecutor, resolveKiroProfileArnAcrossRegions } from "../../open-sse/executors/kiro.js";
import { wrapNdjsonAsOpenAISse } from "../../open-sse/executors/commandcode.js";
import {
  CursorExecutor,
  __setCursorHttp2ForTesting,
  appendBoundedCursorChunk,
  readCursorResponseBody,
} from "../../open-sse/executors/cursor.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import zlib from "node:zlib";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

let restoreHttp2 = null;
let restoreFetch = null;
afterEach(() => {
  restoreHttp2?.();
  restoreHttp2 = null;
  restoreFetch?.();
  restoreFetch = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = (checksum >>> 8) ^ CRC32_TABLE[(checksum ^ byte) & 0xff];
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function writeAwsEventCrcs(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(8, crc32(bytes.subarray(0, 8)), false);
  view.setUint32(bytes.byteLength - 4, crc32(bytes.subarray(0, -4)), false);
  return bytes;
}

function awsEventFrame(eventType, payload = {}, rawPayload = null) {
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(rawPayload ?? JSON.stringify(payload));
  const nameBytes = encoder.encode(":event-type");
  const valueBytes = encoder.encode(eventType);
  const headersLength = 1 + nameBytes.length + 1 + 2 + valueBytes.length;
  const totalLength = 12 + headersLength + payloadBytes.length + 4;
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headersLength, false);
  let offset = 12;
  bytes[offset++] = nameBytes.length;
  bytes.set(nameBytes, offset);
  offset += nameBytes.length;
  bytes[offset++] = 7;
  view.setUint16(offset, valueBytes.length, false);
  offset += 2;
  bytes.set(valueBytes, offset);
  offset += valueBytes.length;
  bytes.set(payloadBytes, offset);
  return writeAwsEventCrcs(bytes);
}

function oversizedAwsEventPrelude(totalLength = 16 * 1024 * 1024 + 1, headersLength = 0) {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headersLength, false);
  return bytes;
}

function cursorTextPayload(text) {
  const response = encodeField(1, 2, text);
  return Buffer.from(encodeField(2, 2, response));
}

function cursorTextFrame(text) {
  return Buffer.from(wrapConnectRPCFrame(cursorTextPayload(text)));
}

function corruptCompressedCursorFrame() {
  const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = 0x01;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

function compressedCursorFrame(payload) {
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = 0x01;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

async function terminalCount(sseText, format) {
  const terminal = vi.fn();
  const transform = createPassthroughStreamWithLogger(
    "test-provider", null, null, "test-model", "conn", {}, null, null, format, terminal,
  );
  await new Response(new Response(sseText).body.pipeThrough(transform)).text();
  return terminal.mock.calls.length;
}

describe("special executor terminal integrity", () => {
  it("uses the standard CRC32 polynomial for AWS EventStream fixtures", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("does not treat a truncated Kiro EventStream as success", async () => {
    const executor = new KiroExecutor();
    const response = executor.transformEventStreamToSSE(
      new Response(awsEventFrame("assistantResponseEvent", { content: "partial" })),
      "kiro-model",
    );
    const text = await response.text();
    expect(text).toContain("stream ended before messageStopEvent");
    expect(text).not.toContain("[DONE]");
    expect(await terminalCount(text, FORMATS.KIRO)).toBe(0);
  });

  it("emits a fixed error for byte-truncated Kiro frames, even after a terminal", async () => {
    const executor = new KiroExecutor();
    const frame = awsEventFrame("assistantResponseEvent", { content: "partial" });
    const terminal = awsEventFrame("messageStopEvent", {});
    for (const body of [
      frame.slice(0, -1),
      new Blob([terminal, frame.slice(0, -1)]).stream(),
    ]) {
      const text = await executor.transformEventStreamToSSE(
        new Response(body),
        "kiro-model",
      ).text();
      expect(text).toContain("truncated EventStream frame");
      expect(text).not.toContain("[DONE]");
      expect(await terminalCount(text, FORMATS.KIRO)).toBe(0);
    }
  });

  it("rejects oversized Kiro EventStream declarations before buffering the frame", async () => {
    const executor = new KiroExecutor();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(oversizedAwsEventPrelude());
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    });
    const text = await executor.transformEventStreamToSSE(
      new Response(body),
      "kiro-model",
    ).text();
    expect(text).toContain("invalid EventStream frame");
    expect(text).not.toContain("[DONE]");
    expect(await terminalCount(text, FORMATS.KIRO)).toBe(0);
  });

  it("accepts Kiro only after messageStopEvent", async () => {
    const executor = new KiroExecutor();
    const body = new Blob([
      awsEventFrame("assistantResponseEvent", { content: "ok" }),
      awsEventFrame("messageStopEvent", {}),
    ]).stream();
    const text = await executor.transformEventStreamToSSE(new Response(body), "kiro-model").text();
    expect(text).toContain("[DONE]");
    expect(await terminalCount(text, FORMATS.KIRO)).toBe(1);
  });

  it("rejects Kiro output or a duplicate stop after messageStopEvent", async () => {
    for (const lateFrame of [
      awsEventFrame("assistantResponseEvent", { content: "late" }),
      awsEventFrame("messageStopEvent", {}),
    ]) {
      const body = new Blob([
        awsEventFrame("messageStopEvent", {}),
        lateFrame,
      ]).stream();
      const text = await new KiroExecutor().transformEventStreamToSSE(
        new Response(body),
        "kiro-model",
      ).text();
      expect(text).toContain("invalid EventStream frame");
      expect(text).not.toContain("[DONE]");
      expect(await terminalCount(text, FORMATS.KIRO)).toBe(0);
    }
  });

  it("rejects exact-length Kiro frames with bad CRC, headers, or JSON terminals", async () => {
    const badPreludeCrc = awsEventFrame("messageStopEvent", {});
    badPreludeCrc[8] ^= 0xff;
    const badMessageCrc = awsEventFrame("messageStopEvent", {});
    badMessageCrc[badMessageCrc.length - 1] ^= 0xff;
    const badHeader = awsEventFrame("messageStopEvent", {});
    const headerTypeOffset = 12 + 1 + badHeader[12];
    badHeader[headerTypeOffset] = 0xff;
    writeAwsEventCrcs(badHeader);
    const badPayload = awsEventFrame("messageStopEvent", {}, "{provider-secret");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const frame of [badPreludeCrc, badMessageCrc, badHeader, badPayload]) {
      const text = await new KiroExecutor().transformEventStreamToSSE(
        new Response(frame),
        "kiro-model",
      ).text();
      expect(text).toContain("invalid EventStream frame");
      expect(text).not.toContain("[DONE]");
      expect(text).not.toContain("provider-secret");
      expect(await terminalCount(text, FORMATS.KIRO)).toBe(0);
    }
    expect(warn.mock.calls.flat().join(" ")).not.toContain("provider-secret");
  });

  it("keeps CommandCode errors and truncated EOF sticky", async () => {
    for (const ndjson of [
      `${JSON.stringify({ type: "error", error: { message: "secret provider failure" } })}\n`,
      `${JSON.stringify({ type: "text-delta", text: "partial" })}\n`,
    ]) {
      const text = await wrapNdjsonAsOpenAISse(new Response(ndjson), "command-model").text();
      expect(text).toContain("stream_error");
      expect(text).not.toContain("[DONE]");
      expect(await terminalCount(text, FORMATS.COMMANDCODE)).toBe(0);
      expect(text).not.toContain("secret provider failure");
    }
  });

  it("accepts CommandCode only after its raw finish event", async () => {
    const ndjson = [
      JSON.stringify({ type: "text-delta", text: "ok" }),
      JSON.stringify({ type: "finish-step", finishReason: "stop" }),
      JSON.stringify({ type: "finish" }),
      "",
    ].join("\n");
    const text = await wrapNdjsonAsOpenAISse(new Response(ndjson), "command-model").text();
    expect(text).toContain("[DONE]");
    expect(await terminalCount(text, FORMATS.COMMANDCODE)).toBe(1);
  });

  it("rejects every nonempty CommandCode frame after finish", async () => {
    for (const lateEvent of [
      { type: "text-delta", text: "late" },
      { type: "finish" },
    ]) {
      const ndjson = [
        JSON.stringify({ type: "finish" }),
        JSON.stringify(lateEvent),
        "",
      ].join("\n");
      const text = await wrapNdjsonAsOpenAISse(new Response(ndjson), "command-model").text();
      expect(text).toContain("data after finish");
      expect(text).not.toContain("[DONE]");
      expect(await terminalCount(text, FORMATS.COMMANDCODE)).toBe(0);
    }
  });

  it("rejects Cursor incomplete and late-error frames instead of synthesizing success", async () => {
    const executor = new CursorExecutor();
    const incomplete = Buffer.from([0, 0, 0, 0, 10, 1, 2]);
    const incompleteResponse = executor.transformProtobufToSSE(incomplete, "cursor-model", {});
    expect(incompleteResponse.status).toBe(502);

    const errorFrame = Buffer.from(wrapConnectRPCFrame(Buffer.from(JSON.stringify({
      error: { code: "resource_exhausted", message: "limited" },
    }))));
    const lateError = executor.transformProtobufToSSE(
      Buffer.concat([cursorTextFrame("partial"), errorFrame]),
      "cursor-model",
      {},
    );
    expect(lateError.status).toBe(429);
    expect((await lateError.json()).error.type).toBe("rate_limit_error");
  });

  it("rejects an exact-length corrupt compressed Cursor frame", async () => {
    const executor = new CursorExecutor();
    const response = executor.transformProtobufToSSE(
      corruptCompressedCursorFrame(),
      "cursor-model",
      {},
    );
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain("undecodable protobuf frame");
    expect(text).not.toContain("[DONE]");
  });

  it("rejects compressed Cursor frames that expand beyond the cumulative body budget", async () => {
    const executor = new CursorExecutor();
    const compressed = zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024 + 1, 65));
    const response = executor.transformProtobufToSSE(
      compressedCursorFrame(compressed),
      "cursor-model",
      {},
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("undecodable protobuf frame");
  });

  it("enforces the cumulative Cursor decompression budget in SSE and JSON modes", async () => {
    const text = "A".repeat(4 * 1024 * 1024 + 256 * 1024);
    const compressed = zlib.gzipSync(cursorTextPayload(text));
    const frames = Buffer.concat([
      compressedCursorFrame(compressed),
      compressedCursorFrame(compressed),
    ]);
    const executor = new CursorExecutor();

    for (const response of [
      executor.transformProtobufToSSE(frames, "cursor-model", {}),
      executor.transformProtobufToJSON(frames, "cursor-model", {}),
    ]) {
      expect(response.status).toBe(502);
      expect(await response.text()).toContain("undecodable protobuf frame");
    }
  });

  it("accepts a Cursor response only after exact complete-frame EOF", async () => {
    const executor = new CursorExecutor();
    const response = executor.transformProtobufToSSE(cursorTextFrame("ok"), "cursor-model", {});
    const text = await response.text();
    expect(text).toContain("[DONE]");
    expect(await terminalCount(text, FORMATS.CURSOR)).toBe(1);
  });

  it("preserves Cursor AbortError instead of returning a 500 provider failure", async () => {
    const executor = new CursorExecutor();
    vi.spyOn(executor, "makeFetchRequest").mockRejectedValue(new DOMException("cancelled", "AbortError"));
    await expect(executor.execute({
      model: "cursor-model",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { accessToken: "token", providerSpecificData: { machineId: "machine" } },
      proxyOptions: { enabled: true },
      attemptStartedAt: 1234,
    })).rejects.toMatchObject({ name: "AbortError", providerAttemptStartedAt: 1234 });
  });

  it("bounds both fetch and HTTP/2 Cursor body accumulation", async () => {
    const cancel = vi.fn();
    const oversized = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(9)); },
      cancel,
    }));
    await expect(readCursorResponseBody(oversized, null, { maxBytes: 8, timeoutMs: 1_000 }))
      .rejects.toThrow("body limit");
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());

    const http2State = { chunks: [], total: 0 };
    appendBoundedCursorChunk(http2State, Buffer.alloc(4), 8);
    expect(() => appendBoundedCursorChunk(http2State, Buffer.alloc(5), 8)).toThrow("body limit");
    expect(http2State.total).toBe(4);
  });

  it("cancels a stalled Cursor fetch body on request abort", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      pull: () => new Promise(() => {}),
      cancel,
    }));
    const controller = new AbortController();
    const pending = readCursorResponseBody(response, controller.signal, { maxBytes: 8, timeoutMs: 1_000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  it("hard-destroys a hung Cursor HTTP/2 request and session on timeout", async () => {
    vi.useFakeTimers();
    const req = new EventEmitter();
    req.write = vi.fn();
    req.end = vi.fn();
    req.close = vi.fn();
    req.destroy = vi.fn();
    const client = new EventEmitter();
    client.request = vi.fn(() => req);
    client.close = vi.fn();
    client.destroy = vi.fn();
    restoreHttp2 = __setCursorHttp2ForTesting({
      connect: vi.fn(() => client),
      constants: { NGHTTP2_CANCEL: 8 },
    });
    const executor = new CursorExecutor();
    executor.config = { ...executor.config, timeoutMs: 25 };

    const pending = executor.makeHttp2Request(
      "https://api2.cursor.sh/path",
      {},
      Buffer.from([1, 2, 3]),
      null,
    );
    const rejection = expect(pending).rejects.toThrow("HTTP/2 request timed out");
    await vi.advanceTimersByTimeAsync(25);
    await rejection;

    expect(req.close).toHaveBeenCalledWith(8);
    expect(req.destroy).toHaveBeenCalledOnce();
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(client.close).not.toHaveBeenCalled();
  });

  it("does not write a Cursor HTTP/2 body when abort wins request setup", async () => {
    const controller = new AbortController();
    const req = new EventEmitter();
    req.write = vi.fn();
    req.end = vi.fn();
    req.close = vi.fn();
    req.destroy = vi.fn();
    const client = new EventEmitter();
    client.request = vi.fn(() => {
      controller.abort();
      return req;
    });
    client.close = vi.fn();
    client.destroy = vi.fn();
    restoreHttp2 = __setCursorHttp2ForTesting({
      connect: vi.fn(() => client),
      constants: { NGHTTP2_CANCEL: 8 },
    });

    await expect(new CursorExecutor().makeHttp2Request(
      "https://api2.cursor.sh/path",
      {},
      Buffer.from([1, 2, 3]),
      controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(req.write).not.toHaveBeenCalled();
    expect(req.end).not.toHaveBeenCalled();
    expect(req.destroy).toHaveBeenCalledOnce();
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it("aborts a forced Cursor fetch that never returns response headers", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    restoreFetch = __setOriginalFetchForTesting(fetch);
    const executor = new CursorExecutor();
    executor.config = { ...executor.config, timeoutMs: 25 };

    const pending = executor.makeFetchRequest(
      "https://api2.cursor.sh/path",
      {},
      Buffer.from([1, 2, 3]),
      null,
      { vercelRelayUrl: "https://relay.example.test" },
    );
    const rejection = expect(pending).rejects.toThrow("Cursor response headers timed out");
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("propagates caller AbortError through the forced Cursor fetch path", async () => {
    const fetch = vi.fn((_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    restoreFetch = __setOriginalFetchForTesting(fetch);
    const controller = new AbortController();
    const pending = new CursorExecutor().makeFetchRequest(
      "https://api2.cursor.sh/path",
      {},
      Buffer.from([1, 2, 3]),
      controller.signal,
      { vercelRelayUrl: "https://relay.example.test" },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("routes an unavailable strict Cursor pool through the fail-closed proxy boundary", async () => {
    const executor = new CursorExecutor();
    const http2Request = vi.spyOn(executor, "makeHttp2Request");
    const result = await executor.execute({
      model: "cursor-model",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { accessToken: "token", providerSpecificData: { machineId: "machine" } },
      proxyOptions: { strictProxy: true, disableEnvProxy: true },
      attemptStartedAt: 1234,
    });

    expect(http2Request).not.toHaveBeenCalled();
    expect(result.response.status).toBe(500);
    expect(await result.response.text()).toContain("Proxy required but unavailable");
  });

  it("honors ambient Cursor proxy routing while explicit direct mode stays HTTP/2", async () => {
    const envKeys = ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];
    const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.HTTPS_PROXY = "http://proxy.example.test:8080";
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
    try {
      const proxied = new CursorExecutor();
      const proxiedFetch = vi.spyOn(proxied, "makeFetchRequest").mockResolvedValue({
        status: 200,
        headers: {},
        body: cursorTextFrame("proxied"),
      });
      const proxiedHttp2 = vi.spyOn(proxied, "makeHttp2Request");
      const proxiedResult = await proxied.execute({
        model: "cursor-model",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: { accessToken: "token", providerSpecificData: { machineId: "machine" } },
        proxyOptions: { disableEnvProxy: false },
        attemptStartedAt: 1234,
      });
      expect(proxiedFetch).toHaveBeenCalledOnce();
      expect(proxiedHttp2).not.toHaveBeenCalled();
      expect(proxiedResult.terminalProvenance).toBe("validated");

      const direct = new CursorExecutor();
      const directFetch = vi.spyOn(direct, "makeFetchRequest");
      const directHttp2 = vi.spyOn(direct, "makeHttp2Request").mockResolvedValue({
        status: 200,
        headers: {},
        body: cursorTextFrame("direct"),
      });
      const directResult = await direct.execute({
        model: "cursor-model",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: { accessToken: "token", providerSpecificData: { machineId: "machine" } },
        proxyOptions: { proxyMode: "direct", disableEnvProxy: true },
        attemptStartedAt: 1235,
      });
      expect(directHttp2).toHaveBeenCalledOnce();
      expect(directFetch).not.toHaveBeenCalled();
      expect(directResult.terminalProvenance).toBe("validated");
    } finally {
      for (const key of envKeys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

  it("does not start Kiro profile discovery for a pre-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();
    await expect(resolveKiroProfileArnAcrossRegions(
      "token", "us-east-1", null, null, fetchImpl, controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allocates the Kiro runtime clock after profile discovery", async () => {
    const executor = new KiroExecutor();
    let finishDiscovery;
    const discovery = new Promise((resolve) => { finishDiscovery = resolve; });
    vi.spyOn(executor, "ensureKiroProfileArn").mockReturnValue(discovery);
    const baseExecute = vi.spyOn(BaseExecutor.prototype, "execute").mockImplementation(async (args) => ({
      response: new Response("failed", { status: 500 }),
      attemptStartedAt: args.onProviderAttempt(),
    }));
    const onProviderAttempt = vi.fn().mockReturnValue(2002);

    const pending = executor.execute({
      model: "kiro-model",
      body: {},
      credentials: {},
      onProviderAttempt,
      attemptStartedAt: 1001,
    });
    await Promise.resolve();
    expect(onProviderAttempt).not.toHaveBeenCalled();
    finishDiscovery();
    const result = await pending;

    expect(onProviderAttempt).toHaveBeenCalledOnce();
    expect(baseExecute).toHaveBeenCalledWith(expect.objectContaining({ attemptStartedAt: null }));
    expect(result.attemptStartedAt).toBe(2002);
    baseExecute.mockRestore();
  });
});
