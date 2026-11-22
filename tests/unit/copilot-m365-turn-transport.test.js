import { describe, expect, it } from "vitest";
import { encodeFrame } from "../../open-sse/executors/copilot-m365-frames.js";
import { runM365Socket, CopilotM365WebExecutor, __setCopilotM365WebSocketForTesting } from "../../open-sse/executors/copilot-m365-web.js";

class Socket {
  static instances = [];
  readyState = 1;
  handlers = {};
  sent = [];
  constructor(url) { this.url = url; this.constructor.instances.push(this); queueMicrotask(() => this.emit("open")); }
  on(name, fn) { this.handlers[name] = fn; }
  off(name) { delete this.handlers[name]; }
  send(frame) {
    this.sent.push(frame);
    if (frame.includes('"protocol":"json"')) queueMicrotask(() => this.emit("message", Buffer.from(encodeFrame({}))));
  }
  close() { this.readyState = 3; }
  terminate() { this.close(); }
  emit(name, value) { this.handlers[name]?.(value); }
}

class RetrySocket extends Socket {
  static instances = [];
  static failTwice = false;
  send(frame) {
    this.sent.push(frame);
    if (frame.includes('"protocol":"json"')) queueMicrotask(() => this.emit("message", Buffer.from(encodeFrame({}))));
    if (frame.includes('"target":"chat"')) {
      const index = RetrySocket.instances.indexOf(this);
      const reply = index === 0 || RetrySocket.failTwice ?
        encodeFrame({ type: 2, item: { result: { value: "InternalError" } } }) :
        encodeFrame({ type: 1, target: "update", arguments: [{ messages: [{ author: "bot", text: "recovered" }] }] }) +
        encodeFrame({ type: 3, invocationId: "0" });
      queueMicrotask(() => this.emit("message", Buffer.from(reply)));
    }
  }
}

const invocation = { type: 4, target: "chat", invocationId: "0", arguments: [] };
const run = (signal) => runM365Socket({ wsUrl: "wss://example.test/?ConversationId=x", invocation, signal });

describe("Copilot M365 turn transport", () => {
  it("rejects an oversized frame", async () => {
    Socket.instances = [];
    const restore = __setCopilotM365WebSocketForTesting(Socket);
    try {
      const promise = run();
      await new Promise(setImmediate);
      Socket.instances.at(-1).emit("message", Buffer.from("x".repeat(1024 * 1024 + 1) + "\x1e"));
      await expect(promise).rejects.toThrow(/frame exceeded/);
    } finally { restore(); }
  });

  it("sends the Metrics frame and sends stop when the client aborts", async () => {
    Socket.instances = [];
    const restore = __setCopilotM365WebSocketForTesting(Socket);
    const controller = new AbortController();
    try {
      const promise = run(controller.signal);
      await new Promise(setImmediate);
      const socket = Socket.instances.at(-1);
      expect(socket.sent.some((frame) => frame.includes('"target":"Metrics"'))).toBe(true);
      controller.abort();
      await expect(promise).rejects.toThrow(/aborted/);
      expect(socket.sent.some((frame) => frame.includes('"target":"stop"'))).toBe(true);
    } finally { restore(); }
  });

  it("retries a content-less InternalError once with a fresh conversation", async () => {
    RetrySocket.instances = [];
    RetrySocket.failTwice = false;
    const restore = __setCopilotM365WebSocketForTesting(RetrySocket);
    try {
      const result = await new CopilotM365WebExecutor().execute({
        body: { messages: [{ role: "user", content: "hello" }] },
        credentials: { apiKey: "access_token=synthetic; chathubPath=user@tenant" },
        model: "m365copilot/copilot-m365",
        stream: false
      });
      expect(result.response.status).toBe(200);
      expect((await result.response.json()).choices[0].message.content).toBe("recovered");
      expect(RetrySocket.instances).toHaveLength(2);
      expect(new URL(RetrySocket.instances[0].url).searchParams.get("ConversationId"))
        .not.toBe(new URL(RetrySocket.instances[1].url).searchParams.get("ConversationId"));
    } finally { restore(); }
  });

  it("returns the second InternalError without a third attempt", async () => {
    RetrySocket.instances = [];
    RetrySocket.failTwice = true;
    const restore = __setCopilotM365WebSocketForTesting(RetrySocket);
    try {
      const result = await new CopilotM365WebExecutor().execute({
        body: { messages: [{ role: "user", content: "hello" }] },
        credentials: { apiKey: "access_token=synthetic; chathubPath=user@tenant" },
        model: "m365copilot/copilot-m365",
        stream: false
      });
      expect(result.response.status).toBe(502);
      expect(RetrySocket.instances).toHaveLength(2);
    } finally {
      RetrySocket.failTwice = false;
      restore();
    }
  });
});
