import { describe, expect, it, vi, afterEach } from "vitest";
import {
  CopilotWebExecutor,
  __setCopilotWebSocketForTesting,
  extractAccessToken,
  getCopilotMode,
  sessionPoolKey,
  solveHashcash,
} from "../../open-sse/executors/copilot-web.js";

const originalFetch = global.fetch;

class MockCopilotWebSocket {
  static instances = [];
  sent = [];
  listeners = new Map();

  constructor(url, options) {
    this.url = url;
    this.options = options;
    MockCopilotWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open"));
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  send(data) {
    this.sent.push(String(data));
    const parsed = JSON.parse(String(data));
    if (parsed.event === "send") {
      queueMicrotask(() => {
        this.emit("message", JSON.stringify({ event: "appendText", text: "hel" }));
        this.emit("message", JSON.stringify({ event: "appendText", text: "lo" }));
        this.emit("message", JSON.stringify({ event: "done" }));
      });
    }
  }

  close() {
    this.closed = true;
  }

  emit(event, ...args) {
    for (const listener of this.listeners.get(event) || []) listener(...args);
  }
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe("copilot-web helpers", () => {
  it("maps models to Copilot modes", () => {
    expect(getCopilotMode("gpt-4o")).toBe("chat");
    expect(getCopilotMode("copilot-think")).toBe("reasoning");
    expect(getCopilotMode("GPT-5")).toBe("smart");
    expect(getCopilotMode("unknown")).toBe("chat");
  });

  it("extracts access tokens from direct, cookie, and bearer credentials", () => {
    expect(extractAccessToken("access_token=tok; other=1")).toBe("tok");
    expect(extractAccessToken("Bearer bearer-token")).toBe("bearer-token");
    expect(extractAccessToken("raw-token")).toBe("raw-token");
    expect(extractAccessToken("")).toBeNull();
  });

  it("keeps session keys isolated by access token", () => {
    expect(sessionPoolKey("alice")).not.toBe(sessionPoolKey("bob"));
    expect(sessionPoolKey()).toBe("anonymous");
  });

  it("bounds hashcash difficulty", () => {
    expect(solveHashcash("param", 0)).toBeNull();
    expect(solveHashcash("param", 9)).toBeNull();
    expect(typeof solveHashcash("param", 1)).toBe("number");
  });
});

describe("CopilotWebExecutor", () => {
  it("streams OpenAI SSE chunks from Copilot WebSocket frames", async () => {
    MockCopilotWebSocket.instances = [];
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      currentConversationId: "conv-1",
      remainingTurns: 100,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const restore = __setCopilotWebSocketForTesting(MockCopilotWebSocket);
    try {
      const result = await new CopilotWebExecutor().execute({
        model: "copilot",
        stream: true,
        body: { messages: [{ role: "user", content: "say hello" }] },
        credentials: { apiKey: "access_token=tok" },
      });
      const text = await result.response.text();

      expect(result.response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(text).toContain('"content":"hel"');
      expect(text).toContain('"content":"lo"');
      expect(text).toContain("data: [DONE]");
      expect(MockCopilotWebSocket.instances[0].options.headers.Authorization).toBe("Bearer tok");
      expect(MockCopilotWebSocket.instances[0].sent.join("\n")).toContain('"conversationId":"conv-1"');
    } finally {
      restore();
    }
  });
});
