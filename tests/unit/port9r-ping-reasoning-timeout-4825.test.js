import { afterEach, describe, expect, it, vi } from "vitest";
import { pingModelByKind } from "../../src/app/api/models/test/ping.js";

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: vi.fn().mockResolvedValue("machine-id-test"),
}));

// Fake timers cannot drive the native AbortSignal.timeout, so back it with a timer.
function useFakeProbeDeadline() {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Probe timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  });
}

function stubFetchAnsweringAfter(delayMs) {
  vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((resolve, reject) => {
    const body = JSON.stringify({ choices: [{ message: { content: "Hi" } }] });
    const timer = setTimeout(() => resolve(new Response(body, { status: 200 })), delayMs);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  })));
}

describe("port decolua/9router#4825: chat model probe deadline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("accepts a reasoning model that answers after 20 seconds", async () => {
    useFakeProbeDeadline();
    stubFetchAnsweringAfter(20000);

    const pending = pingModelByKind("vx/gemini-4-argon(high)", "llm", "http://127.0.0.1:20127");
    await vi.advanceTimersByTimeAsync(20000);

    expect(await pending).toMatchObject({ ok: true, status: 200 });
  });

  it("still gives up on a chat probe that stalls past 60 seconds", async () => {
    useFakeProbeDeadline();
    stubFetchAnsweringAfter(90000);

    const pending = pingModelByKind("vx/gemini-4-argon(high)", "llm", "http://127.0.0.1:20127");
    await vi.advanceTimersByTimeAsync(60000);

    expect(await pending).toMatchObject({ ok: false, status: 408 });
  });
});
