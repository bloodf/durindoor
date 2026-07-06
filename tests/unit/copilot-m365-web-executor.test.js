import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  buildWsUrl,
  redactWsUrl,
  resolveConnectionParams,
} from "../../open-sse/executors/copilot-m365-connection.js";
import {
  accumulateBotContent,
  buildChatInvocation,
  encodeFrame,
  handshakeFrame,
  keepaliveFrame,
  parseFrame,
  splitFrames,
} from "../../open-sse/executors/copilot-m365-frames.js";
import {
  CopilotM365WebExecutor,
  __setCopilotM365WebSocketForTesting,
} from "../../open-sse/executors/copilot-m365-web.js";

class MockM365WebSocket {
  static instances = [];
  sent = [];
  listeners = new Map();

  constructor(url, options) {
    this.url = url;
    this.options = options;
    MockM365WebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open"));
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  send(data) {
    this.sent.push(String(data));
    const parsed = JSON.parse(String(data).replace(/\x1e$/, ""));
    if (parsed.protocol === "json") {
      queueMicrotask(() => this.emit("message", Buffer.from(encodeFrame({}))));
    }
    if (parsed.type === 4 && parsed.target === "chat") {
      queueMicrotask(() => this.emit("message", Buffer.from(
        encodeFrame({ type: 1, target: "update", arguments: [{ messages: [{ text: "po", author: "bot" }] }] }) +
        encodeFrame({ type: 1, target: "update", arguments: [{ messages: [{ text: "pong", author: "bot" }] }] }) +
        encodeFrame({ type: 3, invocationId: "0" }),
      )));
    }
  }

  close() {
    this.closed = true;
  }

  emit(event, ...args) {
    for (const listener of this.listeners.get(event) || []) listener(...args);
  }
}

describe("copilot-m365 connection helpers", () => {
  it("resolves pasted credentials and redacts WebSocket URLs", () => {
    const params = resolveConnectionParams({
      apiKey: "access_token=SECRET123; chathubPath=user@tenant",
    });
    expect(params).toMatchObject({ accessToken: "SECRET123", chathubPath: "user@tenant" });
    const url = buildWsUrl(params);
    expect(url).toContain("wss://substrate.office.com/m365Copilot/Chathub/user@tenant?");
    expect(new URLSearchParams(url.split("?")[1]).get("access_token")).toBe("SECRET123");
    expect(redactWsUrl(url)).not.toContain("SECRET123");
  });

  it("flattens system and user messages", () => {
    expect(buildPrompt({
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "ping" },
      ],
    })).toContain("[System Instructions]\nBe terse.\n\nping");
  });
});

describe("copilot-m365 frame helpers", () => {
  it("builds and parses SignalR frames", () => {
    expect(handshakeFrame()).toBe(`{"protocol":"json","version":1}\x1e`);
    expect(keepaliveFrame()).toBe(`{"type":6}\x1e`);
    const invocation = buildChatInvocation({ text: "ping", traceId: "trace", sessionId: "session" });
    const { frames } = splitFrames(encodeFrame(invocation));
    expect(parseFrame(frames[0])).toMatchObject({ type: 4, target: "chat" });
  });

  it("turns accumulated bot snapshots into deltas", () => {
    let state = "";
    let result = accumulateBotContent(state, { type: 1, target: "update", arguments: [{ messages: [{ text: "po", author: "bot" }] }] });
    expect(result.delta).toBe("po");
    state = result.next;
    result = accumulateBotContent(state, { type: 1, target: "update", arguments: [{ messages: [{ text: "pong", author: "bot" }] }] });
    expect(result.delta).toBe("ng");
  });
});

describe("CopilotM365WebExecutor", () => {
  it("streams OpenAI SSE chunks from M365 SignalR frames", async () => {
    MockM365WebSocket.instances = [];
    const restore = __setCopilotM365WebSocketForTesting(MockM365WebSocket);
    try {
      const result = await new CopilotM365WebExecutor().execute({
        model: "copilot-m365",
        stream: true,
        body: { messages: [{ role: "user", content: "reply pong" }] },
        credentials: { apiKey: "access_token=SECRET123; chathubPath=user@tenant" },
      });
      const text = await result.response.text();

      expect(result.response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(result.url).toContain("access_token=REDACTED");
      expect(result.url).not.toContain("SECRET123");
      expect(text).toContain('"content":"po"');
      expect(text).toContain('"content":"ng"');
      expect(text).toContain("data: [DONE]");
      expect(MockM365WebSocket.instances[0].sent.join("\n")).toContain('"target":"chat"');
    } finally {
      restore();
    }
  });
});
