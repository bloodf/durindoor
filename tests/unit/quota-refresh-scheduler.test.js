import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_REFRESH_INTERVAL_MS,
  createAutoRefreshScheduler,
  getConnectionLabel,
  getRefreshConnections,
  getRefreshCountdown,
  REFRESH_INTERVAL_MS,
  refreshProviderQuotas,
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

  it("starts the default scheduler at five minutes while Claude remains ten minutes", () => {
    const onCountdown = vi.fn();
    const scheduler = createAutoRefreshScheduler({
      onRefresh: vi.fn(),
      onCountdown,
      isHidden: () => false,
    });

    scheduler.start();

    const claudeEvery = Math.round(CLAUDE_REFRESH_INTERVAL_MS / REFRESH_INTERVAL_MS);

    expect(REFRESH_INTERVAL_MS).toBe(300_000);
    expect(onCountdown).toHaveBeenLastCalledWith(300);
    expect(claudeEvery).toBe(2);
    expect(claudeEvery * REFRESH_INTERVAL_MS).toBe(600_000);
    scheduler.stop();
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

  it("passes force to every manual Refresh All quota fetch, including Claude", async () => {
    const fetchQuota = vi.fn().mockResolvedValue(undefined);
    const connections = [
      { id: "openai-1", provider: "openai" },
      { id: "claude-1", provider: "claude" },
    ];

    await refreshProviderQuotas(connections, true, fetchQuota);

    expect(fetchQuota).toHaveBeenNthCalledWith(1, "openai-1", "openai", { force: true });
    expect(fetchQuota).toHaveBeenNthCalledWith(2, "claude-1", "claude", { force: true });
  });

  it("keeps automatic quota fetches non-forced", async () => {
    const fetchQuota = vi.fn().mockResolvedValue(undefined);

    await refreshProviderQuotas([{ id: "claude-1", provider: "claude" }], false, fetchQuota);

    expect(fetchQuota).toHaveBeenCalledWith("claude-1", "claude", { force: false });
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
