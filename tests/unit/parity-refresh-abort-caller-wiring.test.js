import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: mocks.fetch }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ refreshCredentials: mocks.refresh }) }));
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { refreshAndUpdateCredentials } from "../../src/shared/services/providerCredentials.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import { __clearRefreshDedupCacheForTesting } from "../../open-sse/services/tokenRefresh/dedup.js";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); mocks.fetch.mockReset(); mocks.refresh.mockReset(); __clearRefreshDedupCacheForTesting(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
for (const [name, handler, body] of [
  ["embeddings", handleEmbeddingsCore, { input: "hello" }],
  ["images", handleImageGenerationCore, { prompt: "hello" }],
]) {
  for (const injected of [false, true]) it(`${name}: ${injected ? "injected" : "fallback"} refresh detaches and persists without retry or mutation`, async () => {
    const rotation = deferred(); const started = deferred(); const persisted = vi.fn();
    const refresh = vi.fn(async () => { started.resolve(); const value = await rotation.promise; if (injected) persisted(value); return value; });
    mocks.refresh.mockImplementation(refresh);
    mocks.fetch.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", mocks.fetch);
    const controller = new AbortController(); const credentials = { accessToken: "old", refreshToken: "old-refresh" };
    let result;
    const pending = handler({ body, modelInfo: { provider: "openai", model: "test" }, credentials, signal: controller.signal,
      ...(injected ? { refreshCredentials: refresh } : {}), onCredentialsRefreshed: persisted }).then(value => { result = value; });
    await started.promise;
    controller.abort(); await flush();
    expect(result?.status).toBe(499);
    expect(credentials.accessToken).toBe("old");
    rotation.resolve({ accessToken: "new", refreshToken: "new-refresh" }); await flush(); await pending;
    expect(persisted).toHaveBeenCalledWith({ accessToken: "new", refreshToken: "new-refresh" });
    expect(credentials.accessToken).toBe("old"); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it(`${name}: abort while fallback persistence is pending leaves it running`, async () => {
    const saving = deferred(); const entered = deferred();
    const persist = vi.fn(() => { entered.resolve(); return saving.promise; });
    mocks.refresh.mockResolvedValue({ accessToken: "new" });
    mocks.fetch.mockResolvedValue(new Response("unauthorized", { status: 401 })); vi.stubGlobal("fetch", mocks.fetch);
    const controller = new AbortController(); const credentials = { accessToken: "old", refreshToken: "old" }; let result;
    const pending = handler({ body, modelInfo: { provider: "openai", model: "test" }, credentials, signal: controller.signal, onCredentialsRefreshed: persist }).then(value => { result = value; });
    await entered.promise; controller.abort(); await flush(); expect(result?.status).toBe(499);
    expect(credentials.accessToken).toBe("old"); saving.resolve(); await pending;
    expect(persist).toHaveBeenCalledTimes(1); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it(`${name}: abort during fallback backoff stops further refresh attempts`, async () => {
    mocks.fetch.mockResolvedValue(new Response("unauthorized", { status: 401 })); vi.stubGlobal("fetch", mocks.fetch);
    mocks.refresh.mockResolvedValue(null);
    const controller = new AbortController(); let result;
    const pending = handler({ body, modelInfo: { provider: "openai", model: "test" }, credentials: { refreshToken: "old" }, signal: controller.signal }).then(value => { result = value; });
    await flush(); expect(mocks.refresh).toHaveBeenCalledTimes(1); controller.abort(); await flush();
    expect(result?.status).toBe(499); await vi.advanceTimersByTimeAsync(10000); await pending;
    expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
}
it("Cursor dispatch forwards pre-abort without starting a network exchange", async () => {
  const controller = new AbortController(); controller.abort();
  let error;
  const pending = refreshTokenByProvider("cursor", { refreshToken: "pre" }, null, null, { signal: controller.signal }).catch(value => { error = value; });
  await flush(); expect(error?.name).toBe("AbortError"); await pending;
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("Cursor dispatch detaches one caller while the shared runtime signal and second caller continue", async () => {
  const network = deferred(); mocks.fetch.mockReturnValue(network.promise);
  const controller = new AbortController(); let aborted = false;
  const first = refreshTokenByProvider("cursor", { refreshToken: "shared" }, null, null, { signal: controller.signal }).catch(error => { aborted = error.name === "AbortError"; });
  const second = refreshTokenByProvider("cursor", { refreshToken: "shared" }, null);
  await flush(); controller.abort(); await flush(); expect(aborted).toBe(true);
  expect(mocks.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(false);
  network.resolve(new Response(JSON.stringify({ accessToken: "new" }))); await first;
  await expect(second).resolves.toMatchObject({ accessToken: "new" }); expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("embeddings injected providerCredentials refresh persists late rotation after the handler returns 499", async () => {
  const rotation = deferred(); const started = deferred();
  const connection = { id: "caller-wiring", provider: "openai", accessToken: "old", refreshToken: "old-refresh", providerSpecificData: {} };
  const update = vi.fn(async (_id, data) => ({ applied: true, connection: { ...connection, ...data } }));
  const executor = { needsRefresh: () => true, refreshCredentials: vi.fn(() => { started.resolve(); return rotation.promise; }) };
  const controller = new AbortController();
  const refreshCredentials = async ({ signal }) => {
    const result = await refreshAndUpdateCredentials(connection, false, null, {
      signal, getExecutorImpl: () => executor, getProviderConnectionByIdImpl: async () => connection,
      updateProviderConnectionImpl: update, now: () => 1700000000000,
    });
    return result.connection;
  };
  mocks.fetch.mockResolvedValue(new Response("unauthorized", { status: 401 }));
  let result;
  const pending = handleEmbeddingsCore({ body: { input: "hello" }, modelInfo: { provider: "openai", model: "test" }, credentials: { ...connection }, refreshCredentials, signal: controller.signal }).then(value => { result = value; });
  await started.promise; controller.abort(); await flush(); expect(result?.status).toBe(499);
  rotation.resolve({ accessToken: "new", refreshToken: "rotated", expiresIn: 3600 }); await flush(); await pending;
  expect(update).toHaveBeenCalledTimes(1); expect(update.mock.calls[0][1]).toMatchObject({ accessToken: "new", refreshToken: "rotated" });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
