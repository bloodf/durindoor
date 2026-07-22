import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  compressWithHeadroom,
  getHeadroomCircuitState,
  resetHeadroomCircuit,
} from "../../open-sse/rtk/headroom.js";
import { getHeadroomStatusStats } from "../../open-sse/rtk/headroomCircuit.js";

const THRESHOLD = 3;

describe("Headroom retry circuit", () => {
  beforeEach(() => {
    resetHeadroomCircuit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries one transient failure and resets after success", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ role: "user", content: "short" }] }) });
    const body = { messages: [{ role: "user", content: "long" }] };
    expect(await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", model: "x" })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getHeadroomCircuitState().degraded).toBe(false);
  });

  it("increments consecutive failures on repeated HTTP errors and opens circuit at threshold", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503 });
    const body = { messages: [{ role: "user", content: "long" }] };
    for (let i = 0; i < THRESHOLD; i += 1) {
      expect(getHeadroomCircuitState().consecutiveFailures).toBe(i);
      const result = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", model: "x" });
      expect(result).toBeNull();
    }
    expect(getHeadroomCircuitState().degraded).toBe(true);
    // Once the circuit is open, fetch should not be called again.
    const callsBeforeSkip = fetch.mock.calls.length;
    await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", model: "x" });
    expect(fetch.mock.calls.length).toBe(callsBeforeSkip);
  });

  it("resets consecutive failures after a successful call", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503 });
    const body = { messages: [{ role: "user", content: "long" }] };
    await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", model: "x" });
    await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", model: "x" });
    expect(getHeadroomCircuitState().consecutiveFailures).toBe(2);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ role: "user", content: "short" }] }),
    });
    await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", model: "x" });
    expect(getHeadroomCircuitState().degraded).toBe(false);
    expect(getHeadroomCircuitState().consecutiveFailures).toBe(0);
  });

  it("recovers via half-open after the cooldown window elapses", async () => {
    // Test the breaker's time-based recovery directly with an injected clock —
    // no fake timers (which deadlock against the async retry/backoff path).
    const { incrementHeadroomFailures, getHeadroomCircuitState: circuitState } =
      await import("../../open-sse/rtk/headroomCircuit.js");
    // incrementHeadroomFailures stamps openedAt = Date.now(); base the synthetic
    // clock on that real instant so the elapsed math is meaningful.
    for (let i = 0; i < THRESHOLD; i += 1) incrementHeadroomFailures();
    const openedAt = Date.now();
    // Open immediately after tripping.
    expect(circuitState(openedAt).degraded).toBe(true);
    expect(circuitState(openedAt).halfOpen).toBe(false);
    // Still open partway through the cooldown.
    expect(circuitState(openedAt + 30_000).degraded).toBe(true);
    // After the 60s cooldown the circuit is half-open (not degraded → one probe
    // is allowed through instead of latching degraded forever).
    expect(circuitState(openedAt + 61_000).degraded).toBe(false);
    expect(circuitState(openedAt + 61_000).halfOpen).toBe(true);
  });

  it("exposes status stats without importing browser modules", () => {
    const stats = getHeadroomStatusStats();
    expect(stats).toHaveProperty("degraded");
    expect(stats).toHaveProperty("consecutiveFailures");
    expect(stats).toHaveProperty("threshold", THRESHOLD);
  });
});
