import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: transport.fetch }));
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const stateKey = "__kimchi_ua_state";
let previousState;
let errors;

const release = (tag) => ({
  ok: true, status: 200, statusText: "OK", json: async () => ({ tag_name: tag }),
});

beforeEach(() => {
  previousState = globalThis[stateKey];
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected unmocked transport"); }));
  errors = vi.spyOn(console, "error"); // Retain diagnostics; never hide updater errors.
  transport.fetch.mockReset();
  transport.fetch.mockResolvedValue(release("v1.2.3"));
  globalThis[stateKey] = {
    currentAgent: "kimchi/0.1.01", lastFetchTime: 0,
    activePromise: null, intervalStarted: false,
  };
});

afterEach(async () => {
  await globalThis[stateKey]?.activePromise;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (previousState === undefined) delete globalThis[stateKey];
  else globalThis[stateKey] = previousState;
  vi.resetModules();
});

describe("Kimchi updater default transport import", () => {
  it("keeps module reads and complete provider registry construction inert", async () => {
    const updater = await import("../../open-sse/utils/kimchiUserAgent.js");
    const { PROVIDERS } = await import("../../open-sse/providers/index.js");
    expect(PROVIDERS.kimchi.headers["User-Agent"]).toBe("kimchi/0.1.01");
    expect(updater.getKimchiUserAgent()).toBe("kimchi/0.1.01");
    // Join any accidental startup work so errors cannot escape this assertion.
    await globalThis[stateKey].activePromise;
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(globalThis[stateKey].intervalStarted).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  });

  it("loads the proxy transport without an injected fetcher and updates the shared agent", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(appRoot);
    const updater = await import("../../open-sse/utils/kimchiUserAgent.js");
    expect(await updater.updateKimchiUserAgent()).toBe("kimchi/1.2.3");
    expect(updater.getKimchiUserAgent()).toBe("kimchi/1.2.3");
    expect(transport.fetch).toHaveBeenCalledExactlyOnceWith(
      "https://api.github.com/repos/getkimchi/kimchi/releases/latest",
      { method: "GET", headers: { Accept: "application/vnd.github+json", "User-Agent": "9router/1.0.0" } },
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(globalThis[stateKey].activePromise).toBeNull();
  });

  it("uses refreshed headers in an executor constructed before the refresh", async () => {
    const { PROVIDERS } = await import("../../open-sse/providers/index.js");
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const executor = new DefaultExecutor("kimchi");
    expect(PROVIDERS.kimchi.headers["User-Agent"]).toBe("kimchi/0.1.01");
    expect(executor.buildHeaders()["User-Agent"]).toBe("kimchi/0.1.01");
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    const { updateKimchiUserAgent } = await import("../../open-sse/utils/kimchiUserAgent.js");
    await updateKimchiUserAgent();

    expect(executor.buildHeaders()["User-Agent"]).toBe("kimchi/1.2.3");
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it("runs source startup and four-hour refresh from outside the application root", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(fileURLToPath(new URL("../", import.meta.url)));
    globalThis[stateKey].intervalStarted = false;
    const updater = await import("../../open-sse/utils/kimchiUserAgent.js");
    updater.startKimchiUserAgentUpdater();
    updater.startKimchiUserAgentUpdater();
    await updater.updateKimchiUserAgent(); // Join the startup refresh.
    expect(updater.getKimchiUserAgent()).toBe("kimchi/1.2.3");
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.resetModules();
    const reloaded = await import("../../open-sse/utils/kimchiUserAgent.js");
    reloaded.startKimchiUserAgentUpdater();
    expect(vi.getTimerCount()).toBe(1);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    transport.fetch.mockResolvedValue(release("v1.2.4"));
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    await updater.updateKimchiUserAgent();
    expect(updater.getKimchiUserAgent()).toBe("kimchi/1.2.4");
    expect(transport.fetch).toHaveBeenCalledTimes(2);
    expect(errors).not.toHaveBeenCalled();
  });

  it("deduplicates default-transport calls and keeps the successful one-hour cache", async () => {
    let resolveFetch;
    transport.fetch.mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));
    const updater = await import("../../open-sse/utils/kimchiUserAgent.js");
    const first = updater.updateKimchiUserAgent();
    const second = updater.updateKimchiUserAgent();
    // Dynamic imports settle through the module runner, not the fake clock.
    await vi.waitFor(() => expect(transport.fetch).toHaveBeenCalledTimes(1));
    resolveFetch(release("v2.0.0"));
    expect(await Promise.all([first, second])).toEqual(["kimchi/2.0.0", "kimchi/2.0.0"]);
    expect(await updater.updateKimchiUserAgent()).toBe("kimchi/2.0.0");
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  });

  it("logs transport failures and retains the current agent without caching failure", async () => {
    const failure = new Error("offline fixture transport failure");
    transport.fetch.mockRejectedValueOnce(failure);
    const updater = await import("../../open-sse/utils/kimchiUserAgent.js");
    expect(await updater.updateKimchiUserAgent()).toBe("kimchi/0.1.01");
    expect(errors).toHaveBeenCalledExactlyOnceWith("[KimchiUA Error]", failure);
    expect(globalThis[stateKey].lastFetchTime).toBe(0);
    expect(await updater.updateKimchiUserAgent()).toBe("kimchi/1.2.3");
    expect(transport.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not load or call the server transport in a browser", async () => {
    globalThis[stateKey].intervalStarted = false;
    vi.stubGlobal("window", {});
    const updater = await import("../../open-sse/utils/kimchiUserAgent.js");
    updater.startKimchiUserAgentUpdater();
    expect(await updater.updateKimchiUserAgent()).toBe("kimchi/0.1.01");
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });
});
