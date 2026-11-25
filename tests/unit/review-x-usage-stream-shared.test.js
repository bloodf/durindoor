import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUsageStats: vi.fn() }));
const emitter = vi.hoisted(() => {
  // Created inside hoisted so the mock factory can reference it.
  return { value: null };
});

vi.mock("@/lib/usageDb", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  emitter.value = new Emitter();
  emitter.value.setMaxListeners(0);
  return { getUsageStats: mocks.getUsageStats, statsEmitter: emitter.value };
});

import { GET } from "@/app/api/usage/stream/route.js";

const request = (period, key, controller) => new Request(
  `http://localhost/api/usage/stream?period=${period}`,
  { headers: { authorization: `Bearer ${key}` }, signal: controller.signal },
);
const decode = (chunk) => JSON.parse(new TextDecoder().decode(chunk.value).replace(/^data: /, ""));

describe("usage stream shares one stats computation per scope", () => {
  let version;
  beforeEach(() => {
    vi.useFakeTimers();
    version = 0;
    // A computation takes 10ms, as a real aggregation takes some time.
    mocks.getUsageStats.mockReset();
    mocks.getUsageStats.mockImplementation((period) => new Promise((resolve) => {
      setTimeout(() => resolve({ period, version: ++version }), 10);
    }));
  });
  afterEach(() => vi.useRealTimers());

  it("computes once per period for 5 subscribers and 20 usage events in one interval", async () => {
    const controller = new AbortController();
    const readers = [];
    // Five distinct principals (per-key caps are unchanged), same period.
    for (let i = 0; i < 5; i++) {
      const pending = GET(request("7d", `key-${i}`, controller));
      await vi.advanceTimersByTimeAsync(10);
      readers.push((await pending).body.getReader());
    }
    for (const reader of readers) expect(decode(await reader.read())).toMatchObject({ period: "7d" });
    expect(mocks.getUsageStats).toHaveBeenCalledTimes(1);

    mocks.getUsageStats.mockClear();
    for (let i = 0; i < 20; i++) {
      emitter.value.emit(i % 2 ? "pending" : "update");
      await vi.advanceTimersByTimeAsync(45);
    }
    await vi.advanceTimersByTimeAsync(2500);

    expect(mocks.getUsageStats).toHaveBeenCalledTimes(1);
    const payloads = [];
    for (const reader of readers) payloads.push(decode(await reader.read()));
    expect(new Set(payloads.map((payload) => payload.version)).size).toBe(1);
    expect(payloads[0].version).toBe(2);

    controller.abort();
    await Promise.all(readers.map((reader) => reader.cancel()));
    expect(emitter.value.listenerCount("update")).toBe(0);
    expect(emitter.value.listenerCount("pending")).toBe(0);
  });

  it("computes once for each distinct period, not once per client", async () => {
    const controller = new AbortController();
    const readers = [];
    for (const [period, key] of [["today", "a"], ["today", "b"], ["7d", "c"], ["7d", "d"], ["7d", "e"]]) {
      const pending = GET(request(period, key, controller));
      await vi.advanceTimersByTimeAsync(10);
      readers.push({ period, reader: (await pending).body.getReader() });
    }
    for (const { reader } of readers) await reader.read();
    mocks.getUsageStats.mockClear();

    for (let i = 0; i < 20; i++) emitter.value.emit("update");
    await vi.advanceTimersByTimeAsync(1100);

    expect(mocks.getUsageStats.mock.calls.map(([period]) => period).sort()).toEqual(["7d", "today"]);
    for (const { period, reader } of readers) expect(decode(await reader.read()).period).toBe(period);

    controller.abort();
    await Promise.all(readers.map(({ reader }) => reader.cancel()));
  });
});
