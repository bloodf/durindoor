import { afterEach, describe, expect, it, vi } from "vitest";

import { createStreamController } from "../../open-sse/utils/streamHandler.js";

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

const { POST } = await import("../../src/app/api/v1/responses/route.js");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe("explicit streaming Responses route", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps an explicit streaming request open until the delayed response arrives", async () => {
    vi.useFakeTimers();
    const upstream = deferred();
    mocks.handleChat.mockReturnValue(upstream.promise);
    const request = new Request("https://router.test/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-test", input: "hello", stream: true }),
    });

    const pendingResponse = POST(request);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    const response = await pendingResponse;
    const reader = response.body.getReader();

    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": keepalive\n\n");
    expect(mocks.handleChat).toHaveBeenCalledWith(request);

    upstream.resolve(new Response(
      "event: response.completed\ndata: {\"type\":\"response.completed\"}\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    ));

    const next = await reader.read();
    expect(new TextDecoder().decode(next.value)).toContain("response.completed");
    expect(next.done).toBe(false);
  });

  it("forwards an external abort to the stream controller", () => {
    const external = new AbortController();
    const onDisconnect = vi.fn();
    const controller = createStreamController({
      externalSignal: external.signal,
      onDisconnect,
      log: { line: vi.fn() },
    });

    external.abort("client_closed");

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("client_closed");
    expect(onDisconnect).toHaveBeenCalledWith({
      reason: "client_closed",
      duration: expect.any(Number),
    });
  });
});
