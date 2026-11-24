import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWsPromptFrame, parseProtoFields } from "open-sse/executors/muse-spark-web/ws-frame.js";
import { __setMuseSparkFreshTokenFetcherForTesting, __setMuseSparkWebSocketForTesting } from "open-sse/executors/muse-spark-web.js";

function varint(value) {
  let current = BigInt(value);
  const bytes = [];
  while (current > 127n) {
    bytes.push(Number(current & 127n) | 128);
    current >>= 7n;
  }
  bytes.push(Number(current));
  return bytes;
}

function field(number, wireType, value) {
  const tag = varint(number * 8 + wireType);
  if (wireType === 0) return [...tag, ...varint(value)];
  return [...tag, ...varint(value.length), ...value];
}

function readFramePayload(frame) {
  const message = new TextDecoder().decode(frame.slice(8));
  return JSON.parse(message).payload;
}

afterEach(() => {
  __setMuseSparkFreshTokenFetcherForTesting(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Muse Spark review regressions", () => {
  it("preserves a 64-bit timestamp while parsing and rebuilding a prompt frame", () => {
    const timestamp = 1700000000123;
    const inner = new Uint8Array([
      ...field(1, 2, new TextEncoder().encode("old-conversation")),
      ...field(2, 0, timestamp),
      ...field(3, 0, 7),
    ]);
    const nested = new Uint8Array([...field(5, 2, inner)]);
    const template = new Uint8Array([...field(1, 2, nested)]);
    const parsed = parseProtoFields(template);
    const rebuilt = buildWsPromptFrame("prompt", "conversation", {
      templateB64: Buffer.from(template).toString("base64"),
      requestId: "request",
      userMessageId: "message",
      submittedMs: 100,
      uniqueMessageId: 200,
    });
    const payload = Buffer.from(readFramePayload(rebuilt), "base64");
    const outerFields = parseProtoFields(payload);
    const innerFields = parseProtoFields(outerFields[0].value);
    const timestampField = parseProtoFields(innerFields[0].value).find((entry) => entry.number === 2);
    expect(parseProtoFields(parsed[0].value)[0].number).toBe(5);
    expect(timestampField.value).toBe(timestamp);
  });

  it("resets the WS idle timeout on frames and returns text when it expires", async () => {
    vi.useFakeTimers();
    __setMuseSparkFreshTokenFetcherForTesting(async () => ({ ok: true, token: "ecto1:test" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    let restoreSocket;
    class SlowSocket {
      constructor() {
        queueMicrotask(() => this.onopen());
      }
      send() {
        if (this.sent) return;
        this.sent = true;
        setTimeout(() => this.onmessage({ data: JSON.stringify({ type: "patch", operations: [{ op: "delta", path: "/sections/0/view_model/primitive/text", value: "partial answer" }] }) }), 20000);
      }
      close() {}
    }
    restoreSocket = __setMuseSparkWebSocketForTesting(SlowSocket);
    try {
      const { getExecutor } = await import("open-sse/executors/index.js");
      const pending = getExecutor("muse-spark-web").execute({
        model: "muse-spark",
        body: { messages: [{ role: "user", content: "hello" }] },
        stream: false,
        credentials: { connectionId: "timeout-regression", apiKey: "ecto_1_sess=test", providerSpecificData: { enableSessionDispatch: true } },
      });
      await vi.advanceTimersByTimeAsync(20000);
      await vi.advanceTimersByTimeAsync(30000);
      const result = await pending;
      expect(result.response.status).toBe(200);
      expect(await result.response.text()).toContain("partial answer");
    } finally {
      restoreSocket();
    }
  });
});
