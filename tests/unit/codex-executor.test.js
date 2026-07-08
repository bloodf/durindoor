import { describe, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

function makeResponse(bodyChunks, status = 200) {
  return new Response(new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of bodyChunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("Codex executor", () => {
  const baseUrl = "https://api.openai.com/v1/responses";
  const fetchMock = vi.mocked(proxyAwareFetch);

  it("derives compact URL per request on a shared executor instance", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      return makeResponse([
        "event: response.output_text.delta\n",
        "data: {\"delta\":\"hi\"}\n\n",
      ]);
    });

    const executor = new CodexExecutor();
    executor.config.baseUrl = baseUrl;

    const credentials = { apiKey: "key-1" };
    await executor.execute({
      model: "codex",
      body: { _compact: true, input: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
    });
    await executor.execute({
      model: "codex",
      body: { input: [{ role: "user", content: "hi again" }] },
      stream: true,
      credentials,
    });

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls[0]).toBe(`${baseUrl}/compact`);
    expect(urls[1]).toBe(baseUrl);
    expect(credentials).not.toHaveProperty("_isCompact");
  });

  it("does not abort an SSE stream when assistant output contains capacity text", async () => {
    const executor = new CodexExecutor();

    const peek = await executor._peekSseTransientError(makeResponse([
      "event: response.output_text.delta\n",
      'data: {\"delta\":\"We are at capacity today\\n```\\nserver_is_overloaded\\n\"}\n\n',
    ]));

    expect(peek.matched).toBeNull();
    expect(peek.accountFallback).toBe(false);
    expect(peek.replacementBody).toBeTruthy();
  });
});
