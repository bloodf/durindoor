import { afterEach, describe, expect, it, vi } from "vitest";

// A delay above 2^31-1 ms makes Node fire the timer after about 1 ms.
const TIMER_LIMIT_MS = 2 ** 31 - 1;
const OVERSIZED = "3000000000";

describe("OmniRoute #20196 - timeouts above the Node timer limit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("caps oversized env timeouts at the timer limit", async () => {
    vi.stubEnv("STREAM_FIRST_CHUNK_TIMEOUT_MS", OVERSIZED);
    vi.stubEnv("STREAM_STALL_TIMEOUT_MS", OVERSIZED);
    vi.stubEnv("FETCH_CONNECT_TIMEOUT_MS", OVERSIZED);
    vi.stubEnv("SSE_KEEPALIVE_MS", OVERSIZED);
    vi.stubEnv("STREAM_EARLY_EOF_PEEK_MS", OVERSIZED);
    vi.stubEnv("MAX_PROVIDER_BODY_BYTES", OVERSIZED);
    vi.resetModules();
    const config = await import("../../open-sse/config/runtimeConfig.js");

    expect(config.STREAM_FIRST_CHUNK_TIMEOUT_MS).toBe(TIMER_LIMIT_MS);
    expect(config.STREAM_STALL_TIMEOUT_MS).toBe(TIMER_LIMIT_MS);
    expect(config.FETCH_CONNECT_TIMEOUT_MS).toBe(TIMER_LIMIT_MS);
    expect(config.SSE_KEEPALIVE_MS).toBe(TIMER_LIMIT_MS);
    expect(config.STREAM_EARLY_EOF_PEEK_MS).toBe(TIMER_LIMIT_MS);
    // Byte caps are not timers and keep the configured value.
    expect(config.MAX_PROVIDER_BODY_BYTES).toBe(Number(OVERSIZED));
  });

  it("does not fire an oversized first-chunk watchdog at once", async () => {
    vi.stubEnv("STREAM_FIRST_CHUNK_TIMEOUT_MS", OVERSIZED);
    vi.stubEnv("STREAM_STALL_TIMEOUT_MS", OVERSIZED);
    vi.resetModules();
    const { createStreamController, pipeWithDisconnect } = await import("../../open-sse/utils/streamHandler.js");
    const errors = [];
    const controller = createStreamController({ onError: (error) => errors.push(error) });
    const upstream = new ReadableStream({
      async start(source) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        source.enqueue(new TextEncoder().encode("data: late\n\n"));
        source.close();
      },
    });

    const piped = pipeWithDisconnect(new Response(upstream), new TransformStream(), controller);
    const text = await new Response(piped).text();

    expect(text).toContain("data: late");
    expect(errors).toEqual([]);
  });
});
