import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStreamController, pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";

const LIMIT = 1000;
const encoder = new TextEncoder();

function pipe({ chunks = 2, endless = false, gapMs = 0 } = {}) {
  const released = vi.fn();
  const failed = vi.fn();
  const controller = createStreamController({
    onComplete: released,
    onDisconnect: released,
    onError: (error) => { failed(error.message); released(); },
    log: { line() {}, errorLine() {} },
    provider: "test",
    model: "model-a",
  });
  let sent = 0;
  const upstream = new ReadableStream({
    async pull(source) {
      if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
      if (!endless && sent >= chunks) return source.close();
      sent += 1;
      source.enqueue(encoder.encode(`data: ${sent}\n\n`));
    },
  });
  const body = pipeWithDisconnect(new Response(upstream), new TransformStream(), controller, null, LIMIT, null, null, null, null, null, 0, LIMIT);
  return { reader: body.getReader(), released, failed };
}

describe("OmniRoute #19764 — an abandoned streamed body releases its slot", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("releases when a finished upstream reply is never read", async () => {
    const { released, failed } = pipe();
    await vi.advanceTimersByTimeAsync(LIMIT * 3);
    expect(released).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith("client stopped reading the stream");
  });

  it("releases when the client stops part way through a finished reply", async () => {
    const { reader, released } = pipe();
    await reader.read();
    await vi.advanceTimersByTimeAsync(LIMIT * 3);
    expect(released).toHaveBeenCalledOnce();
  });

  it("keeps releasing an unread reply that upstream is still sending", async () => {
    const { released, failed } = pipe({ endless: true, gapMs: 10 });
    await vi.advanceTimersByTimeAsync(LIMIT * 3);
    expect(released).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith("stream stall timeout");
  });

  it("does not cut a slow client that keeps reading a finished reply", async () => {
    const { reader, released, failed } = pipe();
    const seen = [];
    for (;;) {
      await vi.advanceTimersByTimeAsync(LIMIT - 100);
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(new TextDecoder().decode(value));
    }
    await vi.advanceTimersByTimeAsync(LIMIT * 3);
    expect(seen).toEqual(["data: 1\n\n", "data: 2\n\n"]);
    expect(released).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  });
});
