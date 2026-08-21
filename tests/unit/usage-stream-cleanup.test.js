import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = { update: new Set(), pending: new Set() };
  return {
    listeners,
    getUsageStats: vi.fn(),
    getActiveRequests: vi.fn(),
    statsEmitter: {
      on(event, listener) {
        listeners[event].add(listener);
      },
      off(event, listener) {
        listeners[event].delete(listener);
      },
    },
  };
});

vi.mock("@/lib/usageDb", () => ({
  getUsageStats: mocks.getUsageStats,
  getActiveRequests: mocks.getActiveRequests,
  statsEmitter: mocks.statsEmitter,
}));

import { GET } from "@/app/api/usage/stream/route.js";
const request = (period, controller = new AbortController()) => ({
  signal: controller.signal,
  url: `http://localhost/api/usage/stream${period ? `?period=${period}` : ""}`,
});

describe("usage SSE cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.update.clear();
    mocks.listeners.pending.clear();
    mocks.getUsageStats.mockResolvedValue({
      totalRequests: 4,
      byProvider: { openai: { requests: 4 } },
      activeRequests: [{ model: "live", provider: "openai", account: "Current", count: 1 }],
      activeSessions: [{ id: "live-session" }],
      recentRequests: [{ model: "live" }],
      errorProvider: "openai",
      pending: { byModel: { live: 1 }, byAccount: {} },
    });
    mocks.getActiveRequests.mockResolvedValue({
      activeRequests: [{ model: "activity-only", provider: "openai", account: "Old", count: 1 }],
      activeSessions: [{ id: "activity-only-session" }],
      recentRequests: [],
      errorProvider: "",
      pending: { byModel: {}, byAccount: {} },
    });
  });

  it("removes emitter listeners when request aborts", async () => {
    const controller = new AbortController();
    const response = await GET(request(null, controller));
    const reader = response.body.getReader();

    await reader.read();
    expect(mocks.listeners.update.size).toBe(1);
    expect(mocks.listeners.pending.size).toBe(1);

    controller.abort();
    await Promise.resolve();

    expect(mocks.listeners.update.size).toBe(0);
    expect(mocks.listeners.pending.size).toBe(0);
    await reader.cancel();
  });

  it("does not attach listeners for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();

    const response = await GET(request(null, controller));
    const reader = response.body.getReader();
    const result = await reader.read();

    expect(result.done).toBe(true);
    expect(mocks.listeners.update.size).toBe(0);
    expect(mocks.listeners.pending.size).toBe(0);
  });

  it("removes listeners when request aborts during initial activity load", async () => {
    let resolveStats;
    mocks.getUsageStats.mockReturnValue(new Promise((resolve) => {
      resolveStats = resolve;
    }));
    const controller = new AbortController();

    await GET(request(null, controller));
    controller.abort();
    resolveStats({ totalRequests: 0, activeRequests: [], activeSessions: [], recentRequests: [], errorProvider: "", pending: {} });
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.listeners.update.size).toBe(0);
    expect(mocks.listeners.pending.size).toBe(0);
  });

  it("emits a period-filtered full snapshot with the live activity overlay", async () => {
    const response = await GET(request("7d"));
    const reader = response.body.getReader();
    const { value } = await reader.read();
    const payload = JSON.parse(new TextDecoder().decode(value).slice(6));

    expect(mocks.getUsageStats).toHaveBeenCalledWith("7d");
    expect(payload).toMatchObject({
      totalRequests: 4,
      byProvider: { openai: { requests: 4 } },
      activeRequests: [{ model: "live", provider: "openai", account: "Current", count: 1 }],
      activeSessions: [{ id: "live-session" }],
      recentRequests: [{ model: "live" }],
      pending: { byModel: { live: 1 }, byAccount: {} },
    });
    await reader.cancel();
  });

  it("rejects an invalid period before opening the stream", async () => {
    const response = await GET(request("bogus"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid period" });
    expect(mocks.getUsageStats).not.toHaveBeenCalled();
    expect(mocks.getActiveRequests).not.toHaveBeenCalled();
    expect(mocks.listeners.update.size).toBe(0);
    expect(mocks.listeners.pending.size).toBe(0);
  });

  it("coalesces updates while an activity snapshot is in flight", async () => {
    let resolveFirst;
    mocks.getUsageStats
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValue({ totalRequests: 1, activeRequests: [], activeSessions: [], recentRequests: [], errorProvider: "", pending: {} });

    const response = await GET(request(null));
    const reader = response.body.getReader();
    await Promise.resolve();

    for (const listener of mocks.listeners.update) listener();
    for (const listener of mocks.listeners.pending) listener();
    expect(mocks.getUsageStats).toHaveBeenCalledTimes(1);

    resolveFirst({ totalRequests: 0, activeRequests: [], activeSessions: [], recentRequests: [], errorProvider: "", pending: {} });
    await reader.read();
    await reader.read();

    expect(mocks.getUsageStats).toHaveBeenCalledTimes(2);
    await reader.cancel();
  });
});
