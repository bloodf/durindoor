import { describe, expect, it, vi, afterEach } from "vitest";
import {
  CopilotWebExecutor,
  __setCopilotWebSocketForTesting,
  extractAccessToken,
  flattenPrompt,
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

class ErrorCopilotWebSocket extends MockCopilotWebSocket {
  send(data) {
    this.sent.push(String(data));
    const parsed = JSON.parse(String(data));
    if (parsed.event === "send") {
      queueMicrotask(() => {
        this.emit("message", JSON.stringify({ event: "error", error: "upstream rejected" }));
      });
    }
  }
}

class ReplaceTextCopilotWebSocket extends MockCopilotWebSocket {
  send(data) {
    this.sent.push(String(data));
    const parsed = JSON.parse(String(data));
    if (parsed.event === "send") {
      queueMicrotask(() => {
        this.emit("message", JSON.stringify({ event: "appendText", text: "hel" }));
        this.emit("message", JSON.stringify({ event: "replaceText", text: "hello" }));
        this.emit("message", JSON.stringify({ event: "done" }));
      });
    }
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
    expect(extractAccessToken(`foo=bar; access_token=${"x".repeat(120)}; other=1`)).toBe("x".repeat(120));
    expect(extractAccessToken("raw-token")).toBe("raw-token");
    expect(extractAccessToken("")).toBeNull();
  });

  it("preserves prior chat turns in the flattened prompt", () => {
    const prompt = flattenPrompt({
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "my name is Bob" },
        { role: "assistant", content: "Noted." },
        { role: "user", content: "what is my name?" },
      ],
    });
    expect(prompt).toContain("[System Instructions]\nBe terse.");
    expect(prompt).toContain("[User]\nmy name is Bob");
    expect(prompt).toContain("[Assistant]\nNoted.");
    expect(prompt).toContain("[User]\nwhat is my name?");
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
      expect(MockCopilotWebSocket.instances[0].options.headers.Cookie).toBeUndefined();
      expect(MockCopilotWebSocket.instances[0].sent.join("\n")).toContain('"conversationId":"conv-1"');
    } finally {
      restore();
    }
  });

  it("starts a fresh Copilot conversation for each API request", async () => {
    MockCopilotWebSocket.instances = [];
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ currentConversationId: "conv-1", remainingTurns: 100 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ currentConversationId: "conv-2", remainingTurns: 100 }), { status: 200 }));
    const restore = __setCopilotWebSocketForTesting(MockCopilotWebSocket);
    try {
      const exec = new CopilotWebExecutor();
      for (let i = 0; i < 2; i++) {
        const result = await exec.execute({
          model: "copilot",
          stream: false,
          body: { messages: [{ role: "user", content: `hello ${i}` }] },
          credentials: { apiKey: "access_token=tok" },
        });
        expect(result.response.status).toBe(200);
      }
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(MockCopilotWebSocket.instances[0].sent.join("\n")).toContain('"conversationId":"conv-1"');
      expect(MockCopilotWebSocket.instances[1].sent.join("\n")).toContain('"conversationId":"conv-2"');
    } finally {
      restore();
    }
  });

  it("returns non-stream WebSocket error frames as failures", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      currentConversationId: "conv-err",
      remainingTurns: 100,
    }), { status: 200 }));
    const restore = __setCopilotWebSocketForTesting(ErrorCopilotWebSocket);
    try {
      const result = await new CopilotWebExecutor().execute({
        model: "copilot",
        stream: false,
        body: { messages: [{ role: "user", content: "fail" }] },
        credentials: { apiKey: "access_token=tok" },
      });
      expect(result.response.status).toBe(502);
      await expect(result.response.json()).resolves.toMatchObject({
        error: { message: "upstream rejected" },
      });
    } finally {
      restore();
    }
  });

  it("emits only incremental deltas for replaceText snapshots", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      currentConversationId: "conv-replace",
      remainingTurns: 100,
    }), { status: 200 }));
    const restore = __setCopilotWebSocketForTesting(ReplaceTextCopilotWebSocket);
    try {
      const result = await new CopilotWebExecutor().execute({
        model: "copilot",
        stream: true,
        body: { messages: [{ role: "user", content: "say hello" }] },
        credentials: { apiKey: "access_token=tok" },
      });
      const text = await result.response.text();
      expect(text).toContain('"content":"hel"');
      expect(text).toContain('"content":"lo"');
      expect(text).not.toContain('"content":"hello"');
    } finally {
      restore();
    }
  });

  it("passes HTTP connection proxies to the Copilot WebSocket agent", async () => {
    MockCopilotWebSocket.instances = [];
    const restore = __setCopilotWebSocketForTesting(MockCopilotWebSocket);
    try {
      const stream = await new CopilotWebExecutor().wsChat({
        conversationId: "conv-proxy",
        prompt: "hello",
        mode: "chat",
        model: "copilot",
        accessToken: "tok",
        proxyOptions: {
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://proxy.local:8080",
        },
      });
      await new Response(stream).text();
      expect(MockCopilotWebSocket.instances[0].options.agent).toBeTruthy();
    } finally {
      restore();
    }
  });
});
