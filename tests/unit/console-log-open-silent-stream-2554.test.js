import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startConsoleLogTransport } from "@/app/(dashboard)/dashboard/console-log/transport.js";

class FakeEventSource {
  static latest = null;

  constructor() {
    this.closed = false;
    FakeEventSource.latest = this;
  }

  close() {
    this.closed = true;
  }
}

describe("console log stream that opens but delivers nothing (upstream decolua/9router#2554)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const start = async () => {
    const statuses = [];
    const transport = startConsoleLogTransport({
      fetchImpl: async () => new Response(JSON.stringify({ success: true, logs: [] })),
      EventSourceImpl: FakeEventSource,
      onSnapshot: vi.fn(),
      onEvent: vi.fn(),
      onStatus: ({ state }) => statuses.push(state),
      pollIntervalMs: 1000,
      streamTimeoutMs: 5000,
    });
    await transport.ready;
    FakeEventSource.latest.onopen();
    return { transport, statuses };
  };

  it("falls back to polling when a tunnel forwards headers but buffers every event", async () => {
    const { transport, statuses } = await start();

    await vi.advanceTimersByTimeAsync(5000);

    expect(FakeEventSource.latest.closed).toBe(true);
    expect(statuses.at(-1)).toBe("polling");
    transport.stop();
  });

  it("stays on the stream once the first event arrives", async () => {
    const { transport, statuses } = await start();
    FakeEventSource.latest.onmessage({ data: JSON.stringify({ type: "init", logs: [] }) });

    await vi.advanceTimersByTimeAsync(60000);

    expect(FakeEventSource.latest.closed).toBe(false);
    expect(statuses.at(-1)).toBe("streaming");
    transport.stop();
  });
});
