import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", async (orig) => ({
  ...(await orig()),
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/localDb.js", () => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(async () => ({})),
}));

import { BaseExecutor, raceCallerAbort, waitForRetryDelay } from "../../open-sse/executors/base.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { refreshMediaCredentials } from "../../open-sse/handlers/mediaRefresh.js";
import { refreshWithRetry } from "../../open-sse/services/tokenRefresh.js";
import { refreshCursorToken } from "../../open-sse/services/tokenRefresh/cursor.js";
import { __clearRefreshDedupCacheForTesting } from "../../open-sse/services/tokenRefresh/dedup.js";
import { refreshAndUpdateCredentials } from "../../src/shared/services/providerCredentials.js";

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const unhandledRejections = [];
const onUnhandledRejection = (reason) => {
  unhandledRejections.push(reason);
};

beforeEach(() => {
  unhandledRejections.length = 0;
  mocks.proxyAwareFetch.mockReset();
  process.on("unhandledRejection", onUnhandledRejection);
  __clearRefreshDedupCacheForTesting();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await flushMicrotasks();
  process.off("unhandledRejection", onUnhandledRejection);
  expect(unhandledRejections).toEqual([]);
});

describe("refreshWithRetry abort responsiveness", () => {
  it("pre-aborted signal rejects immediately without invoking refreshFn or leaking listeners", async () => {
    const controller = new AbortController();
    controller.abort("client_gone");
    const refreshFn = vi.fn(async () => ({ accessToken: "never" }));

    await expect(refreshWithRetry(refreshFn, 3, silentLog, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });

    expect(refreshFn).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("aborts during retry backoff promptly via fake timers without scheduling a next retry", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const refreshFn = vi.fn(async () => null);

    const pending = refreshWithRetry(refreshFn, 3, silentLog, { signal: controller.signal });
    const settled = pending.then(
      () => ({ rejected: false }),
      (error) => ({ rejected: true, error })
    );

    expect(refreshFn).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(10);
    controller.abort("client_gone");

    const outcome = await settled;
    expect(outcome.rejected).toBe(true);
    expect(outcome.error).toMatchObject({ name: "AbortError" });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it("aborts during non-transient error backoff promptly without launching a next retry", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const refreshFn = vi.fn(async () => {
      throw Object.assign(new Error("upstream 400"), { status: 400 });
    });

    const pending = refreshWithRetry(refreshFn, 3, silentLog, controller.signal);
    const settled = pending.then(
      () => ({ rejected: false }),
      (error) => ({ rejected: true, error })
    );

    expect(refreshFn).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    controller.abort();

    const outcome = await settled;
    expect(outcome.rejected).toBe(true);
    expect(outcome.error).toMatchObject({ name: "AbortError" });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it("detaches caller on mid-flight abort while allowing active refresh and persistence to finish safely", async () => {
    const controller = new AbortController();
    let resolveInFlight;
    let persistedToken = null;
    const refreshFn = vi.fn(async () => {
      const token = await new Promise((resolve) => { resolveInFlight = resolve; });
      persistedToken = token;
      return token;
    });

    const pending = refreshWithRetry(refreshFn, 3, silentLog, { signal: controller.signal });
    expect(refreshFn).toHaveBeenCalledTimes(1);

    controller.abort("client_gone");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

    resolveInFlight({ accessToken: "rotated-access", refreshToken: "rotated-refresh" });
    await flushMicrotasks();
    expect(persistedToken).toEqual({ accessToken: "rotated-access", refreshToken: "rotated-refresh" });
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it("absorbs late rejections from detached in-flight refreshes without unhandled rejections", async () => {
    const controller = new AbortController();
    let rejectInFlight;
    const refreshFn = vi.fn(() => new Promise((_resolve, reject) => { rejectInFlight = reject; }));

    const pending = refreshWithRetry(refreshFn, 3, silentLog, { signal: controller.signal });
    controller.abort("client_gone");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    rejectInFlight(new Error("late background refresh failure"));
    await flushMicrotasks();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("keeps no-signal retry behavior unchanged, including internal AbortError retries", async () => {
    vi.useFakeTimers();
    const refreshFn = vi.fn()
      .mockRejectedValueOnce(new DOMException("upstream fetch timeout", "AbortError"))
      .mockResolvedValueOnce({ accessToken: "ok-after-retry" });

    const pending = refreshWithRetry(refreshFn, 2, silentLog);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ accessToken: "ok-after-retry" });
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });

  it("removes abort listeners cleanly on normal retry completion", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const refreshFn = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ accessToken: "fresh" });

    const pending = refreshWithRetry(refreshFn, 3, silentLog, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual({ accessToken: "fresh" });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});

describe("mediaRefresh abort propagation", () => {
  it("propagates signal to refreshWithRetry for executor fallback and skips pre-aborted calls", async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const executor = { refreshCredentials: vi.fn(async () => ({ accessToken: "unused" })) };

    await expect(refreshMediaCredentials({
      provider: "openai",
      executor,
      credentials: { refreshToken: "rt-1" },
      log: silentLog,
      signal: preAborted.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(executor.refreshCredentials).not.toHaveBeenCalled();

    vi.useFakeTimers();
    const controller = new AbortController();
    const failingExecutor = { refreshCredentials: vi.fn(async () => null) };
    const pending = refreshMediaCredentials({
      provider: "openai",
      executor: failingExecutor,
      credentials: { refreshToken: "rt-1" },
      log: silentLog,
      signal: controller.signal,
    });
    const settled = pending.then(
      () => ({ rejected: false }),
      (error) => ({ rejected: true, error })
    );

    expect(failingExecutor.refreshCredentials).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    controller.abort();

    const outcome = await settled;
    expect(outcome.rejected).toBe(true);
    expect(outcome.error).toMatchObject({ name: "AbortError" });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(5000);
    expect(failingExecutor.refreshCredentials).toHaveBeenCalledTimes(1);
  });

  it("passes signal to injected refreshCredentials, detaches on abort, and preserves no-signal call shape", async () => {
    const noSignalRefresher = vi.fn(async () => ({ accessToken: "legacy" }));
    await expect(refreshMediaCredentials({
      provider: "antigravity",
      executor: { refreshCredentials: vi.fn() },
      credentials: {},
      refreshCredentials: noSignalRefresher,
      log: silentLog,
    })).resolves.toEqual({ accessToken: "legacy" });
    expect(noSignalRefresher).toHaveBeenCalledWith();

    let resolveInjected;
    let persisted = false;
    const injectedRefresher = vi.fn(async () => {
      const value = await new Promise((resolve) => { resolveInjected = resolve; });
      persisted = true;
      return value;
    });
    const controller = new AbortController();
    const pending = refreshMediaCredentials({
      provider: "antigravity",
      executor: { refreshCredentials: vi.fn() },
      credentials: {},
      refreshCredentials: injectedRefresher,
      log: silentLog,
      signal: controller.signal,
    });

    expect(injectedRefresher).toHaveBeenCalledWith({ signal: controller.signal });
    controller.abort("client_gone");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

    resolveInjected({ accessToken: "leased-rotated" });
    await flushMicrotasks();
    expect(persisted).toBe(true);
  });
});

describe("standalone chatCore and BaseExecutor fallback abort handling", () => {
  it("races standalone chatCore executor.refreshCredentials against abort while persisting rotated tokens", async () => {
    const controller = new AbortController();
    let resolveRefresh;
    const persisted = [];
    const execute = vi.fn(async () => ({
      response: new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      url: "https://provider.example.test/v1/chat/completions",
      headers: {},
      transformedBody: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    }));
    const refreshCredentials = vi.fn(() => new Promise((resolve) => { resolveRefresh = resolve; }));

    const pending = handleChatCore({
      body: { model: "gpt-4o-mini", stream: false, messages: [{ role: "user", content: "hi" }] },
      modelInfo: { provider: "openai", model: "gpt-4o-mini" },
      credentials: { accessToken: "expired-token", refreshToken: "rt-old", providerSpecificData: {} },
      executorOverride: { noAuth: false, execute, refreshCredentials },
      abortSignal: controller.signal,
      log: silentLog,
      onCredentialsRefreshed: async (rotated) => {
        persisted.push(rotated);
      },
    });

    await vi.waitFor(() => expect(refreshCredentials).toHaveBeenCalledTimes(1));
    controller.abort("client_gone");

    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.status).toBe(499);
    expect(execute).toHaveBeenCalledTimes(1);

    resolveRefresh({ accessToken: "rotated-access", refreshToken: "rotated-refresh" });
    await vi.waitFor(() => expect(persisted).toHaveLength(1));
    expect(persisted[0]).toEqual({ accessToken: "rotated-access", refreshToken: "rotated-refresh" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("absorbs late rejection from detached standalone chatCore refresh without unhandled rejection", async () => {
    const controller = new AbortController();
    let rejectRefresh;
    const execute = vi.fn(async () => ({
      response: new Response("unauthorized", { status: 401 }),
      url: "https://provider.example.test/v1/chat/completions",
      headers: {},
      transformedBody: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    }));
    const refreshCredentials = vi.fn(() => new Promise((_resolve, reject) => { rejectRefresh = reject; }));

    const pending = handleChatCore({
      body: { model: "gpt-4o-mini", stream: false, messages: [{ role: "user", content: "hi" }] },
      modelInfo: { provider: "openai", model: "gpt-4o-mini" },
      credentials: { accessToken: "expired-token", refreshToken: "rt-old", providerSpecificData: {} },
      executorOverride: { noAuth: false, execute, refreshCredentials },
      abortSignal: controller.signal,
      log: silentLog,
    });

    await vi.waitFor(() => expect(refreshCredentials).toHaveBeenCalledTimes(1));
    controller.abort("client_gone");

    const result = await pending;
    expect(result.status).toBe(499);
    rejectRefresh(new Error("late refresh rejection"));
    await flushMicrotasks();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("BaseExecutor.execute aborts 429 retry backoff promptly without trying fallback URLs and normalizes string abort reasons", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const directFetch = vi.fn(async () => new Response("rate limited", { status: 429 }));
    mocks.proxyAwareFetch.mockImplementation((url, options) => options.directFetch(url, options));

    const executor = new BaseExecutor("test-abort-provider", {
      baseUrls: [
        "https://primary.example.test/v1/chat/completions",
        "https://fallback.example.test/v1/chat/completions",
      ],
      headers: {},
      retry: { 429: { attempts: 2, delayMs: 2000 } },
    });

    const pending = executor.execute({
      model: "gpt-4o-mini",
      body: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "sk-test" },
      signal: controller.signal,
      log: silentLog,
      directFetch,
    });
    const settled = pending.then(
      () => ({ rejected: false }),
      (error) => ({ rejected: true, error })
    );

    await vi.waitFor(() => expect(directFetch).toHaveBeenCalledTimes(1));
    await flushMicrotasks();
    controller.abort("client_gone");

    const outcome = await settled;
    expect(outcome.rejected).toBe(true);
    expect(outcome.error).toMatchObject({ name: "AbortError", errorKind: "aborted" });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(directFetch).toHaveBeenCalledTimes(1);
  });

  it("BaseExecutor helpers waitForRetryDelay and raceCallerAbort clean up listeners without unhandled rejections", async () => {
    const controller = new AbortController();
    await expect(raceCallerAbort(Promise.resolve("ok"), controller.signal)).resolves.toBe("ok");
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

    vi.useFakeTimers();
    const delayController = new AbortController();
    const delayPromise = waitForRetryDelay(500, delayController.signal);
    await vi.advanceTimersByTimeAsync(500);
    await expect(delayPromise).resolves.toBeUndefined();
    expect(getEventListeners(delayController.signal, "abort")).toHaveLength(0);

    const preAborted = new AbortController();
    preAborted.abort("already_gone");
    const lateReject = Promise.reject(new Error("detached"));
    await expect(raceCallerAbort(lateReject, preAborted.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(getEventListeners(preAborted.signal, "abort")).toHaveLength(0);
  });
});

describe("shared refresh concurrency and Cursor caller abort waits", () => {
  it("refreshCursorToken pre-aborts without hitting fetch", async () => {
    const controller = new AbortController();
    controller.abort("client_gone");

    await expect(refreshCursorToken("cursor-rt-pre", silentLog, null, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("refreshCursorToken detaches an aborted caller during retry backoff while another concurrent caller succeeds", async () => {
    vi.useFakeTimers();
    let fetchCalls = 0;
    let firstAttemptHit;
    const firstFetchDone = new Promise((resolve) => { firstAttemptHit = resolve; });
    mocks.proxyAwareFetch.mockImplementation(async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        firstAttemptHit();
        return new Response("unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({
        accessToken: "cursor-access-fresh",
        refreshToken: "cursor-rt-rotated",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const callerA = new AbortController();
    const callerB = new AbortController();

    const waitA = refreshCursorToken("cursor-rt-shared", silentLog, null, { signal: callerA.signal });
    const settledA = waitA.then(
      () => ({ rejected: false }),
      (error) => ({ rejected: true, error })
    );
    const waitB = refreshCursorToken("cursor-rt-shared", silentLog, null, { signal: callerB.signal });

    await firstFetchDone;
    await flushMicrotasks();
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);

    // Caller A aborts while the shared Cursor refresh is in retry backoff.
    callerA.abort("client_a_gone");
    const outcomeA = await settledA;
    expect(outcomeA.rejected).toBe(true);
    expect(outcomeA.error).toMatchObject({ name: "AbortError" });
    expect(getEventListeners(callerA.signal, "abort")).toHaveLength(0);

    // Advancing timers lets the shared deduped refresh finish attempt 2 for Caller B.
    await vi.advanceTimersByTimeAsync(1000);
    await expect(waitB).resolves.toMatchObject({
      accessToken: "cursor-access-fresh",
      refreshToken: "cursor-rt-rotated",
    });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(getEventListeners(callerB.signal, "abort")).toHaveLength(0);
  });

  it("refreshCursorToken detaches an aborted caller mid-fetch without aborting the shared network exchange", async () => {
    let resolveFetch;
    let fetchSignalSeen = null;
    let fetchStartedResolve;
    const fetchStarted = new Promise((resolve) => { fetchStartedResolve = resolve; });
    mocks.proxyAwareFetch.mockImplementation((_url, init) => {
      fetchSignalSeen = init?.signal ?? null;
      fetchStartedResolve();
      return new Promise((resolve) => { resolveFetch = resolve; });
    });

    const callerA = new AbortController();
    const callerB = new AbortController();

    const waitA = refreshCursorToken("cursor-rt-inflight", silentLog, null, { signal: callerA.signal });
    const waitB = refreshCursorToken("cursor-rt-inflight", silentLog, null, { signal: callerB.signal });

    await fetchStarted;
    callerA.abort("client_a_gone");
    await expect(waitA).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSignalSeen?.aborted).toBe(false);
    expect(getEventListeners(callerA.signal, "abort")).toHaveLength(0);

    resolveFetch(new Response(JSON.stringify({
      accessToken: "cursor-access-inflight",
      refreshToken: "cursor-rt-inflight-rotated",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(waitB).resolves.toMatchObject({
      accessToken: "cursor-access-inflight",
      refreshToken: "cursor-rt-inflight-rotated",
    });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(getEventListeners(callerB.signal, "abort")).toHaveLength(0);
  });

  it("authoritative providerCredentials shared refresh completes and persists for concurrent caller after first caller aborts", async () => {
    let resolveRefresh;
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(() => new Promise((resolve) => { resolveRefresh = resolve; })),
    };
    const updateProviderConnectionImpl = vi.fn(async (_id, updateData) => ({
      applied: true,
      connection: {
        id: "conn-shared-abort",
        provider: "claude",
        accessToken: updateData.accessToken,
        refreshToken: updateData.refreshToken,
        providerSpecificData: {},
      },
    }));
    const baseConnection = {
      id: "conn-shared-abort",
      provider: "claude",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      providerSpecificData: {},
    };
    const deps = {
      getExecutorImpl: () => executor,
      getProviderConnectionByIdImpl: vi.fn(async () => baseConnection),
      updateProviderConnectionImpl,
      now: () => 1_700_000_000_000,
      log: silentLog,
    };

    const callerA = new AbortController();
    const callerB = new AbortController();

    const first = refreshAndUpdateCredentials(baseConnection, false, null, { ...deps, signal: callerA.signal });
    await vi.waitFor(() => expect(executor.refreshCredentials).toHaveBeenCalledTimes(1));
    const second = refreshAndUpdateCredentials(baseConnection, false, null, { ...deps, signal: callerB.signal });

    callerA.abort("caller_a_gone");
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(getEventListeners(callerA.signal, "abort")).toHaveLength(0);

    resolveRefresh({ accessToken: "shared-new-access", refreshToken: "shared-new-refresh", expiresIn: 3600 });
    await expect(second).resolves.toMatchObject({
      refreshed: true,
      connection: expect.objectContaining({
        accessToken: "shared-new-access",
        refreshToken: "shared-new-refresh",
      }),
    });
    expect(executor.refreshCredentials).toHaveBeenCalledTimes(1);
    expect(updateProviderConnectionImpl).toHaveBeenCalledTimes(1);
    expect(getEventListeners(callerB.signal, "abort")).toHaveLength(0);
  });
});
