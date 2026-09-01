import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(),
  initTranslators: vi.fn(async () => undefined),
}));

vi.mock("@/sse/handlers/chat.js", () => ({
  handleChat: mocks.handleChat,
}));

vi.mock("open-sse/translator/index.js", () => ({
  initTranslators: mocks.initTranslators,
}));

const { POST, HEAD, adaptLegacyBody, mapCompletionResponse } = await import(
  "../../src/app/api/v1/completions/route.js"
);

function postRequest(body, headers = {}) {
  return new Request("https://router.test/v1/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-key",
      "x-session-id": "session-a",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function forwardedBody() {
  const forwarded = mocks.handleChat.mock.calls[0][0];
  return forwarded.clone().json();
}

describe("v1/completions adapter (legacy → chat)", () => {
  it("accepts a string prompt as a single user message", () => {
    const result = adaptLegacyBody({ model: "openai/gpt-4o", prompt: "say hi", max_tokens: 8 });
    expect(result.ok).toBe(true);
    expect(result.chatBody.messages).toEqual([{ role: "user", content: "say hi" }]);
    expect(result.chatBody.model).toBe("openai/gpt-4o");
    expect(result.chatBody.max_tokens).toBe(8);
    expect(result.chatBody).not.toHaveProperty("prompt");
  });

  it("unwraps a single-element prompt array", () => {
    const result = adaptLegacyBody({ model: "openai/gpt-4o", prompt: ["hello"] });
    expect(result.ok).toBe(true);
    expect(result.chatBody.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("rejects a prompt array with more than one element", () => {
    const result = adaptLegacyBody({ model: "openai/gpt-4o", prompt: ["a", "b"] });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("multiple prompts not supported");
  });

  it("rejects a missing prompt", () => {
    const result = adaptLegacyBody({ model: "openai/gpt-4o" });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Missing prompt");
  });
});

describe("POST /v1/completions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initTranslators.mockResolvedValue(undefined);
  });

  it("non-stream: prompt → chat shape → text_completion body", async () => {
    mocks.handleChat.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-abc123",
          object: "chat.completion",
          created: 1700000000,
          model: "openai/gpt-4o",
          choices: [
            { index: 0, message: { role: "assistant", content: "Hi there" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json", "x-trace": "t1" } }
      )
    );

    const response = await POST(postRequest({ model: "openai/gpt-4o", prompt: "say hi", max_tokens: 16 }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-trace")).toBe("t1");
    const chatBody = await forwardedBody();
    expect(chatBody.messages).toEqual([{ role: "user", content: "say hi" }]);
    expect(chatBody.max_tokens).toBe(16);
    expect(chatBody).not.toHaveProperty("prompt");

    const body = await response.json();
    expect(body).toEqual({
      id: "cmpl-abc123",
      object: "text_completion",
      created: 1700000000,
      model: "openai/gpt-4o",
      choices: [{ text: "Hi there", index: 0, logprobs: null, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    });
  });

  it("non-stream: maps every entry of choices[] to text", async () => {
    mocks.handleChat.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-multi",
          object: "chat.completion",
          created: 1700000002,
          model: "openai/gpt-4o",
          choices: [
            { index: 0, message: { role: "assistant", content: "first" }, finish_reason: "stop" },
            { index: 1, message: { role: "assistant", content: "second" }, finish_reason: "length" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const response = await POST(postRequest({ model: "openai/gpt-4o", prompt: "hi", n: 2 }));
    const body = await response.json();
    expect(body.object).toBe("text_completion");
    expect(body.id).toBe("cmpl-multi");
    expect(body.choices).toEqual([
      { text: "first", index: 0, logprobs: null, finish_reason: "stop" },
      { text: "second", index: 1, logprobs: null, finish_reason: "length" },
    ]);
  });

  it("preserves auth headers and propagates abort to the forwarded request", async () => {
    const controller = new AbortController();
    mocks.handleChat.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          created: 1,
          model: "openai/gpt-4o",
          choices: [{ index: 0, message: { content: "ok" }, finish_reason: "stop" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const request = new Request("https://router.test/v1/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-key", "x-session-id": "session-a" },
      body: JSON.stringify({ model: "openai/gpt-4o", prompt: "hi" }),
      signal: controller.signal,
    });

    await POST(request);
    const forwarded = mocks.handleChat.mock.calls[0][0];
    expect(forwarded.headers.get("authorization")).toBe("Bearer test-key");
    expect(forwarded.headers.get("x-session-id")).toBe("session-a");
    expect(forwarded.signal.aborted).toBe(false);
    controller.abort();
    expect(forwarded.signal.aborted).toBe(true);
  });

  it("array with >1 prompts → 400 without invoking handleChat", async () => {
    const response = await POST(postRequest({ model: "openai/gpt-4o", prompt: ["a", "b"] }));
    expect(response.status).toBe(400);
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });

  it("preserves non-2xx error fields while replacing untrusted correlation", async () => {
    const errorPayload = { error: { type: "invalid_request_error", message: "Missing API key" } };
    mocks.handleChat.mockResolvedValue(
      new Response(JSON.stringify(errorPayload), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "content-type": "application/json", "x-request-id": "req-err" },
      })
    );

    const response = await POST(postRequest({ model: "openai/gpt-4o", prompt: "hi" }));
    const requestId = response.headers.get("x-request-id");
    expect(response.status).toBe(401);
    expect(response.statusText).toBe("Unauthorized");
    expect(requestId).not.toBe("req-err");
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await response.json()).toEqual({
      error: { ...errorPayload.error, request_id: requestId },
    });
  });

  it("stream: maps chat.completion.chunk → text_completion and preserves [DONE], split across chunks", async () => {
    const frames = [
      `data: ${JSON.stringify({
        id: "chatcmpl-stream1",
        object: "chat.completion.chunk",
        created: 1700000001,
        model: "openai/gpt-4o",
        choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }],
      })}\n`,
      `\ndata: ${JSON.stringify({
        id: "chatcmpl-stream1",
        object: "chat.completion.chunk",
        created: 1700000001,
        model: "openai/gpt-4o",
        choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }],
      })}\n\ndata: [DONE]\n\n`,
    ];
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        // Split a frame across chunks to exercise the line buffer.
        controller.enqueue(enc.encode(frames[0].slice(0, 12)));
        controller.enqueue(enc.encode(frames[0].slice(12) + frames[1]));
        controller.close();
      },
    });
    mocks.handleChat.mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream", "content-length": "999", "x-stream": "1" },
      })
    );

    const response = await POST(postRequest({ model: "openai/gpt-4o", prompt: "hi", stream: true }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("x-stream")).toBe("1");

    const text = await response.text();
    const events = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    expect(events.at(-1)).toBe("[DONE]");
    const objects = events.filter((e) => e !== "[DONE]").map((e) => JSON.parse(e));
    expect(objects).toEqual([
      {
        id: "cmpl-stream1",
        object: "text_completion",
        created: 1700000001,
        model: "openai/gpt-4o",
        choices: [{ text: "Hel", index: 0, logprobs: null, finish_reason: null }],
      },
      {
        id: "cmpl-stream1",
        object: "text_completion",
        created: 1700000001,
        model: "openai/gpt-4o",
        choices: [{ text: "lo", index: 0, logprobs: null, finish_reason: null }],
      },
    ]);
  });

  it("stream: maps every choices[] entry per chunk, not only index 0", async () => {
    const frame = `data: ${JSON.stringify({
      id: "chatcmpl-n2",
      object: "chat.completion.chunk",
      created: 1700000003,
      model: "openai/gpt-4o",
      choices: [
        { index: 0, delta: { content: "A" }, finish_reason: null },
        { index: 1, delta: { content: "B" }, finish_reason: null },
      ],
    })}\n\ndata: [DONE]\n\n`;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame));
        controller.close();
      },
    });
    mocks.handleChat.mockResolvedValue(
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })
    );

    const response = await POST(postRequest({ model: "openai/gpt-4o", prompt: "hi", stream: true, n: 2 }));
    const text = await response.text();
    const [payload] = text
      .split("\n")
      .filter((line) => line.startsWith("data:") && !line.includes("[DONE]"))
      .map((line) => JSON.parse(line.slice(5).trim()));
    expect(payload.object).toBe("text_completion");
    expect(payload.choices).toEqual([
      { text: "A", index: 0, logprobs: null, finish_reason: null },
      { text: "B", index: 1, logprobs: null, finish_reason: null },
    ]);
  });

  it("drops stale content-length when mapping a JSON body", async () => {
    mocks.handleChat.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-2",
          created: 1,
          model: "openai/gpt-4o",
          choices: [{ index: 0, message: { content: "x" }, finish_reason: "stop" }],
        }),
        { status: 200, headers: { "content-type": "application/json", "content-length": "1" } }
      )
    );

    const response = await POST(postRequest({ model: "openai/gpt-4o", prompt: "hi" }));
    expect(response.headers.get("content-length")).toBeNull();
    expect((await response.json()).id).toBe("cmpl-2");
  });
});

describe("mapCompletionResponse", () => {
  it("leaves a non-2xx response instance untouched", async () => {
    const upstream = new Response("nope", { status: 429 });
    const mapped = await mapCompletionResponse(upstream);
    expect(mapped).toBe(upstream);
  });
});

describe("HEAD /v1/completions", () => {
  it("returns 200 with CORS headers and no body", async () => {
    const response = await HEAD();
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe("");
  });
});
