import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as otel from "../../open-sse/services/otelTracing.js";

const BREAKER_OPEN_MS = 30_000;

async function exportOneSpan(id) {
  otel.otelStart(id, { provider: "p", model: "m" });
  otel.otelFinish(id, { status: "ok" });
  await otel.flushOtel();
}

describe("OmniRoute #20107 - OTLP export breaker", () => {
  let collector;

  beforeEach(() => {
    vi.useFakeTimers();
    collector = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", collector);
    otel.resetOtelForTests({ DURINDOOR_OTEL_ENDPOINT: "http://collector:4318" });
  });

  afterEach(() => {
    otel.resetOtelForTests({});
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("pauses after five failures, then sends one probe", async () => {
    for (let i = 0; i < 5; i++) await exportOneSpan(`span-${i}`);
    expect(collector).toHaveBeenCalledTimes(5);

    await exportOneSpan("while-open");
    expect(collector).toHaveBeenCalledTimes(5);

    collector.mockResolvedValue(new Response("", { status: 200 }));
    await vi.advanceTimersByTimeAsync(BREAKER_OPEN_MS + 5_000);

    expect(collector).toHaveBeenCalledTimes(6);
    expect(otel.getOtelStats()).toMatchObject({ buffered: 0 });
  });
});
