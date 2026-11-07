import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: transport.fetch }));
// Other boot services are outside this fixture. The actual instrumentation,
// Node bootstrap and Kimchi updater all execute; only their I/O is isolated.
vi.mock("../../src/lib/db/repos/settingsRepo.js", () => ({ getSettings: async () => ({ headroomEnabled: false }) }));

const stateKey = "__kimchi_ua_state";
let previousState;
let errors;

beforeEach(() => {
  previousState = globalThis[stateKey];
  delete globalThis[stateKey];
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected unmocked transport"); }));
  errors = vi.spyOn(console, "error");
  transport.fetch.mockReset().mockResolvedValue({
    ok: true, status: 200, statusText: "OK", json: async () => ({ tag_name: "v2.3.4" }),
  });
});

afterEach(async () => {
  await globalThis[stateKey]?.activePromise;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (previousState === undefined) delete globalThis[stateKey];
  else globalThis[stateKey] = previousState;
  vi.resetModules();
});

describe("Kimchi refresh at the real Node bootstrap boundary", () => {
  it("starts on register, once across repeated boot, and unrefs its timer", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const services = [
      ["../../src/lib/startup/nonLoopbackApiKeyGuard.js", "warnIfInferenceServerExposed"],
      ["../../src/lib/dataRetention/scheduler.js", "startDataRetentionScheduler"],
      ["../../src/lib/modelAutoSync/scheduler.js", "startModelAutoSyncScheduler"],
    ];
    const serviceSpies = [];
    for (const [path, name] of services) {
      const service = await vi.importActual(path);
      serviceSpies.push(vi.spyOn(service, name).mockImplementation(() => {}));
    }
    const intervals = vi.spyOn(globalThis, "setInterval");
    const { register } = await import("../../src/instrumentation.js");
    const updater = await import("../../open-sse/utils/kimchiUserAgent.js");
    expect(transport.fetch).not.toHaveBeenCalled();
    register();
    await vi.waitFor(() => expect(updater.getKimchiUserAgent()).toBe("kimchi/2.3.4"));
    register();
    const { bootstrapNodejsRuntime } = await import("../../src/instrumentation.node.js");
    bootstrapNodejsRuntime();
    await vi.dynamicImportSettled();
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    // Other boot dependencies and Vitest polling own timers too. Assert the
    // Kimchi refresh timer itself is unique and cannot hold the server open.
    const refreshIndexes = intervals.mock.calls.flatMap((args, index) =>
      args[1] === 4 * 60 * 60 * 1000 ? [index] : []);
    expect(refreshIndexes).toHaveLength(1);
    expect(intervals.mock.results[refreshIndexes[0]].value.hasRef()).toBe(false);
    for (const spy of serviceSpies) expect(spy).toHaveBeenCalledTimes(3);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it("stops refreshing when its timer is cancelled and starts again in a fresh lifecycle", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const services = [
      ["../../src/lib/startup/nonLoopbackApiKeyGuard.js", "warnIfInferenceServerExposed"],
      ["../../src/lib/dataRetention/scheduler.js", "startDataRetentionScheduler"],
      ["../../src/lib/modelAutoSync/scheduler.js", "startModelAutoSyncScheduler"],
    ];
    const isolateServices = async () => {
      for (const [path, name] of services) {
        const service = await vi.importActual(path);
        vi.spyOn(service, name).mockImplementation(() => {});
      }
    };
    const intervals = vi.spyOn(globalThis, "setInterval");
    const boot = async () => {
      await isolateServices();
      const { register } = await import("../../src/instrumentation.js");
      register();
      await vi.dynamicImportSettled();
      await globalThis[stateKey].activePromise;
    };

    await boot();
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    const firstTimer = intervals.mock.results[intervals.mock.calls.findIndex(
      (args) => args[1] === 4 * 60 * 60 * 1000,
    )].value;
    clearInterval(firstTimer);
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(transport.fetch).toHaveBeenCalledTimes(1);

    // A process restart discards both the old timer and process-global state.
    delete globalThis[stateKey];
    vi.resetModules();
    await boot();
    expect(transport.fetch).toHaveBeenCalledTimes(2);
    transport.fetch.mockResolvedValue({
      ok: true, status: 200, statusText: "OK", json: async () => ({ tag_name: "v2.3.5" }),
    });
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    await globalThis[stateKey].activePromise;
    expect(transport.fetch).toHaveBeenCalledTimes(3);
    expect(globalThis[stateKey].currentAgent).toBe("kimchi/2.3.5");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it("does not start during module evaluation or edge registration", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await import("../../src/instrumentation.node.js");
    const { register } = await import("../../src/instrumentation.js");
    register();
    await vi.dynamicImportSettled();
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });
});
