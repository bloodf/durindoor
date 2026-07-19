import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAutoRefreshScheduler,
  getConnectionLabel,
  getRefreshConnections,
  getRefreshCountdown,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("quota auto-refresh scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives countdown from an absolute deadline", () => {
    const now = Date.now();
    expect(getRefreshCountdown(now + 60_000, now)).toBe(60);
    expect(getRefreshCountdown(now + 1, now)).toBe(1);
    expect(getRefreshCountdown(now - 1, now)).toBe(0);
  });

  it("marks only connections selected for a throttled refresh as loading", () => {
    const visibleConnections = [
      { id: "openai-1", provider: "openai" },
      { id: "claude-1", provider: "claude" },
    ];

    expect(getRefreshConnections(visibleConnections, false, 1, 3)).toEqual([
      visibleConnections[0],
    ]);
  });

  it("prefers canonical provider names over stale stored labels", () => {
    expect(getConnectionLabel({ provider: "ollama", name: "Ollama Production" })).toBe("Ollama Cloud");
    expect(getConnectionLabel({ provider: "custom-provider", name: "My Gateway" })).toBe("My Gateway");
  });

  it("keeps one refresh timer and one countdown timer", async () => {
    const onRefresh = vi.fn();
    const scheduler = createAutoRefreshScheduler({
      intervalMs: 60_000,
      onRefresh,
      onCountdown: vi.fn(),
      isHidden: () => false,
    });

    scheduler.start();
    expect(vi.getTimerCount()).toBe(2);

    scheduler.pause();
    expect(vi.getTimerCount()).toBe(0);

    await scheduler.resume();
    await scheduler.resume();
    expect(vi.getTimerCount()).toBe(2);
    expect(onRefresh).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("refreshes once when visibility resumes after deadline", async () => {
    let hidden = false;
    const onRefresh = vi.fn();
    const scheduler = createAutoRefreshScheduler({
      intervalMs: 60_000,
      onRefresh,
      onCountdown: vi.fn(),
      isHidden: () => hidden,
    });

    scheduler.start();
    hidden = true;
    scheduler.pause();
    vi.setSystemTime(new Date("2026-07-11T12:01:01Z"));
    hidden = false;

    await scheduler.resume();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(2);
    scheduler.stop();
  });

  it("does not overlap a slow refresh", async () => {
    let finishRefresh;
    const onRefresh = vi.fn(() => new Promise((resolve) => {
      finishRefresh = resolve;
    }));
    const scheduler = createAutoRefreshScheduler({
      intervalMs: 60_000,
      onRefresh,
      onCountdown: vi.fn(),
      isHidden: () => false,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    const second = scheduler.refreshNow();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    finishRefresh();
    await second;

    expect(vi.getTimerCount()).toBe(2);
    scheduler.stop();
  });

  it("manual refresh resets deadline after completion", async () => {
    const onCountdown = vi.fn();
    const scheduler = createAutoRefreshScheduler({
      intervalMs: 60_000,
      onRefresh: vi.fn(),
      onCountdown,
      isHidden: () => false,
    });

    scheduler.start();
    vi.setSystemTime(new Date("2026-07-11T12:00:30Z"));
    await scheduler.refreshNow();

    expect(scheduler.getNextRefreshAt()).toBe(Date.now() + 60_000);
    expect(onCountdown).toHaveBeenLastCalledWith(60);
    scheduler.stop();
  });
});
