import { ReadableStream } from "node:stream/web";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import { DuckDuckGoWebExecutor } from "../../../open-sse/executors/duckduckgo-web.js";

vi.mock("../../../open-sse/utils/proxyFetch.js", async () => {
  const actual = await vi.importActual("../../../open-sse/utils/proxyFetch.js");
  return { ...actual, proxyAwareFetch: vi.fn() };
});

import { proxyAwareFetch } from "../../../open-sse/utils/proxyFetch.js";

describe("DuckDuckGoWebExecutor", () => {
  const exec = new DuckDuckGoWebExecutor();
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("buffers split SSE lines across chunks", async () => {
    const chunks = [
      'data: {"content":"Hel","role":"assistant"}\n',
      'data: {"content":"lo","role":"a',
      'ssistant"}\n',
      'data: {"content":"!"}\n',
      'data: [DONE]\n',
    ];
    const upstream = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.endsWith("/status")) return { ok: true, headers: { get: () => "token" } };
      return { ok: true, body: upstream };
    });

    const { response } = await exec.execute({
      model: "duckduckgo-web/gpt-4o-mini",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
    });

    const text = await response.text();
    expect(text).toContain('data: {"choices":[{"delta":{"content":"Hel"},"index":0,"finish_reason":null}]}\n\n');
    expect(text).toContain('data: {"choices":[{"delta":{"content":"lo"},"index":0,"finish_reason":null}]}\n\n');
    expect(text).toContain('data: {"choices":[{"delta":{"content":"!"},"index":0,"finish_reason":null}]}\n\n');
    expect(text).toContain("data: [DONE]\n\n");
  });

  test("passes proxyOptions to both status and chat fetches", async () => {
    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.endsWith("/status")) return { ok: true, headers: { get: () => "token" } };
      const text = 'data: {"content":"ok"}\n';
      return {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
          },
        }),
      };
    });

    await exec.execute({
      model: "duckduckgo-web/gpt-4o-mini",
      body: { messages: [{ role: "user", content: "hi" }] },
      proxyOptions: { proxyUrl: "http://proxy.example:8080" },
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    const [statusCall, chatCall] = proxyAwareFetch.mock.calls;
    expect(statusCall[0]).toContain("/duckchat/v1/status");
    expect(statusCall[2]).toEqual({ proxyUrl: "http://proxy.example:8080" });
    expect(chatCall[0]).toContain("/duckchat/v1/chat");
    expect(chatCall[2]).toEqual({ proxyUrl: "http://proxy.example:8080" });
  });
});
