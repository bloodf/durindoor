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

describe("usage SSE cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.update.clear();
    mocks.listeners.pending.clear();
    mocks.getUsageStats.mockResolvedValue({ totalRequests: 0 });
    mocks.getActiveRequests.mockResolvedValue({
      activeRequests: [],
      recentRequests: [],
      errorProvider: "",
      pending: { byModel: {}, byAccount: {} },
    });
  });

  it("removes emitter listeners when request aborts", async () => {
    const controller = new AbortController();
    const response = await GET({ signal: controller.signal });
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

    const response = await GET({ signal: controller.signal });
    const reader = response.body.getReader();
    const result = await reader.read();

    expect(result.done).toBe(true);
    expect(mocks.listeners.update.size).toBe(0);
    expect(mocks.listeners.pending.size).toBe(0);
  });

  it("removes listeners when request aborts during initial activity load", async () => {
    let resolveStats;
    mocks.getActiveRequests.mockReturnValue(new Promise((resolve) => {
      resolveStats = resolve;
    }));
    const controller = new AbortController();

    await GET({ signal: controller.signal });
    controller.abort();
    resolveStats({ activeRequests: [], recentRequests: [], errorProvider: "", pending: {} });
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.listeners.update.size).toBe(0);
    expect(mocks.listeners.pending.size).toBe(0);
  });

  it("sends only lightweight activity snapshots", async () => {
    const response = await GET({ signal: new AbortController().signal });
    const reader = response.body.getReader();
    const { value } = await reader.read();
    const payload = JSON.parse(new TextDecoder().decode(value).slice(6));

    expect(payload).toEqual({
      activeRequests: [],
      recentRequests: [],
      errorProvider: "",
      pending: { byModel: {}, byAccount: {} },
    });
    expect(mocks.getUsageStats).not.toHaveBeenCalled();
    await reader.cancel();
  });

  it("coalesces updates while an activity snapshot is in flight", async () => {
    let resolveFirst;
    mocks.getActiveRequests
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValue({ activeRequests: [], recentRequests: [], errorProvider: "", pending: {} });

    const response = await GET({ signal: new AbortController().signal });
    const reader = response.body.getReader();
    await Promise.resolve();

    for (const listener of mocks.listeners.update) listener();
    for (const listener of mocks.listeners.pending) listener();
    expect(mocks.getActiveRequests).toHaveBeenCalledTimes(1);

    resolveFirst({ activeRequests: [], recentRequests: [], errorProvider: "", pending: {} });
    await reader.read();
    await reader.read();

    expect(mocks.getActiveRequests).toHaveBeenCalledTimes(2);
    await reader.cancel();
  });
});
