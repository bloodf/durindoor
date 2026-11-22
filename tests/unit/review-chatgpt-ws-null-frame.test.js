// #2262 — ChatGPT-web image WebSocket must skip non-object JSON frames (null,
// numbers, strings, arrays) and catch any handler error instead of letting an
// uncaughtException escape ws.onmessage.
import { describe, it, expect, vi, afterEach } from "vitest";
import { __waitForImageViaWebSocketForTesting } from "../../open-sse/executors/chatgpt-web-http.js";

const CONVERSATION_ID = "conv-ws-null-2262";
const VALID_POINTER = "file-service://file-valid-2262";

function makeValidImageFrame() {
  return JSON.stringify({
    type: "conversation-update",
    payload: {
      conversation_id: CONVERSATION_ID,
      update_content: {
        message: {
          id: "img-msg-2262",
          author: { role: "tool", name: "t2uay3k.sj1i4kz" },
          content: {
            content_type: "multimodal_text",
            parts: [
              {
                content_type: "image_asset_pointer",
                asset_pointer: VALID_POINTER,
                width: 1024,
                height: 1024,
              },
            ],
          },
          status: "finished_successfully",
        },
      },
    },
  });
}

function makeFakeWebSocketClass(frames) {
  return class FakeWebSocket {
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;
    closed = false;
    static instances = [];

    constructor(url) {
      this.url = url;
      FakeWebSocket.instances.push(this);
      setTimeout(() => {
        this.onopen?.();
        let delay = 5;
        for (const frame of frames) {
          setTimeout(() => {
            if (!this.closed) {
              this.onmessage?.(frame);
            }
          }, delay);
          delay += 5;
        }
      }, 5);
    }

    close() {
      this.closed = true;
    }
  };
}

describe("chatgpt-web waitForImageViaWebSocket non-object & bad frames (#2262)", () => {
  const originalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalWebSocket === undefined) {
      delete globalThis.WebSocket;
    } else {
      globalThis.WebSocket = originalWebSocket;
    }
  });

  it("skips null, number, string, array, and unparseable frames without throwing, then resolves on a valid image frame", async () => {
    const uncaught = [];
    const onUncaught = (err) => uncaught.push(err);
    process.on("uncaughtException", onUncaught);

    const FakeWebSocket = makeFakeWebSocketClass([
      { data: "null" },
      { data: "5" },
      { data: '"x"' },
      { data: "[1, 2]" },
      { data: "true" },
      { data: "{invalid json" },
      { data: null },
      { data: makeValidImageFrame() },
    ]);
    globalThis.WebSocket = FakeWebSocket;

    const debugSpy = vi.fn();
    const warnSpy = vi.fn();
    try {
      const outcome = await __waitForImageViaWebSocketForTesting(
        "wss://chatgpt.com/fake-ws-2262",
        CONVERSATION_ID,
        2_000,
        { log: { debug: debugSpy, warn: warnSpy } }
      );

      expect(uncaught).toEqual([]);
      expect(outcome.errored).toBe(false);
      expect(outcome.gotAnyMessage).toBe(true);
      expect(outcome.pointers).toEqual([
        { pointer: VALID_POINTER, messageId: "img-msg-2262" },
      ]);
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(FakeWebSocket.instances[0].closed).toBe(true);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });

  it("catches exceptions thrown inside the handler body, logs at debug level, and still resolves on a later valid frame", async () => {
    const FakeWebSocket = makeFakeWebSocketClass([
      { data: '{"trigger":"boom"}' },
      { data: makeValidImageFrame() },
    ]);
    globalThis.WebSocket = FakeWebSocket;

    const realParse = JSON.parse;
    vi.spyOn(JSON, "parse").mockImplementation((raw) => {
      if (raw === '{"trigger":"boom"}') {
        return {
          get payload() {
            throw new Error("simulated frame handler failure");
          },
        };
      }
      return realParse(raw);
    });

    const debugSpy = vi.fn();
    const warnSpy = vi.fn();

    const outcome = await __waitForImageViaWebSocketForTesting(
      "wss://chatgpt.com/fake-ws-2262-err",
      CONVERSATION_ID,
      2_000,
      { log: { debug: debugSpy, warn: warnSpy } }
    );

    expect(outcome.errored).toBe(false);
    expect(outcome.pointers).toEqual([
      { pointer: VALID_POINTER, messageId: "img-msg-2262" },
    ]);
    expect(debugSpy).toHaveBeenCalledWith(
      "CGPT-WEB",
      expect.stringContaining("simulated frame handler failure")
    );
  });
});
