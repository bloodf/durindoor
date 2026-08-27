import { afterEach, describe, expect, it, vi } from "vitest";
import { ANTHROPIC_PING_FRAME } from "../../open-sse/utils/earlyStreamKeepalive.js";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(),
  initTranslators: vi.fn(async () => undefined),
}));

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: mocks.initTranslators }));

const { POST } = await import("../../src/app/api/v1/messages/route.js");
const decoder = new TextDecoder();

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("port #3457: /v1/messages early keepalive", () => {
  it("emits an Anthropic ping while handleChat is delayed", async () => {
    vi.useFakeTimers();
    const upstream = deferred();
    mocks.handleChat.mockReturnValue(upstream.promise);
    const request = new Request("https://router.test/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-test", messages: [], stream: true }),
    });

    const responsePromise = POST(request);
    await vi.advanceTimersByTimeAsync(2_000);
    const response = await responsePromise;
    const reader = response.body.getReader();

    expect(decoder.decode((await reader.read()).value)).toBe(decoder.decode(ANTHROPIC_PING_FRAME));
    expect(mocks.handleChat).toHaveBeenCalledWith(request);

    upstream.resolve(new Response("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }));
    expect(decoder.decode((await reader.read()).value)).toContain("message_stop");
  });

  it("stops early pings when handleChat supplies its response", async () => {
    vi.useFakeTimers();
    const upstream = deferred();
    mocks.handleChat.mockReturnValue(upstream.promise);
    const request = new Request("https://router.test/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-test", messages: [], stream: true }),
    });

    const responsePromise = POST(request);
    await vi.advanceTimersByTimeAsync(2_000);
    const reader = (await responsePromise).body.getReader();
    expect(decoder.decode((await reader.read()).value)).toBe(decoder.decode(ANTHROPIC_PING_FRAME));

    upstream.resolve(new Response("event: message_start\ndata: {\"type\":\"message_start\"}\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }));
    expect(decoder.decode((await reader.read()).value)).toContain("message_start");
    expect((await reader.read()).done).toBe(true);

    const afterRealByte = reader.read();
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await afterRealByte).done).toBe(true);
  });

  it("SSE_KEEPALIVE_MS=0 disables the early wrapper", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.stubEnv("SSE_KEEPALIVE_MS", "0");
    try {
      const delayed = deferred();
      mocks.handleChat.mockReturnValue(delayed.promise);
      const { POST: disabledPost } = await import("../../src/app/api/v1/messages/route.js?keepalive-disabled");
      const request = new Request("https://router.test/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-test", messages: [], stream: true }),
      });

      let settled = false;
      const responsePromise = disabledPost(request).then((response) => {
        settled = true;
        return response;
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(settled).toBe(false);

      delayed.resolve(new Response("disabled"));
      expect(await (await responsePromise).text()).toBe("disabled");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("leaves non-streaming Messages responses unwrapped", async () => {
    vi.useFakeTimers();
    const delayed = deferred();
    mocks.handleChat.mockReturnValue(delayed.promise);
    const request = new Request("https://router.test/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-test", messages: [], stream: false }),
    });

    let settled = false;
    const responsePromise = POST(request).then((response) => {
      settled = true;
      return response;
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toBe(false);

    delayed.resolve(Response.json({ content: [{ type: "text", text: "done" }] }));
    await expect((await responsePromise).json()).resolves.toMatchObject({ content: [{ text: "done" }] });
  });
});
