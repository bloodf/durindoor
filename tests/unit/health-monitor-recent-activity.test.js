import { describe, expect, it, beforeEach } from "vitest";
import { getHealthPayload, invalidateHealthCache } from "../../src/lib/healthMonitor.js";

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const CONN = (id, provider = "demo") => ({ id, provider, name: id, isActive: true });

// The health probe fires an independent validation request that can disagree
// with the live chat path, so an actively-serving account can read as down.
// buildPayload overlays recent successful requests: a connection that served a
// request within the window is reported healthy even when its probe failed.
describe("healthMonitor recent-activity overlay", () => {
  beforeEach(() => invalidateHealthCache());

  it("upgrades a down probe to healthy when the connection was recently active", async () => {
    const clock = fakeClock();
    const loader = async () => [CONN("a"), CONN("b")];
    // Both probes fail (5xx → down).
    const prober = async () => ({ valid: false, status: 503, error: "boom" });
    // Only connection "a" served a real request recently.
    const recentActivityLoader = async () => new Set(["a"]);

    const payload = await getHealthPayload({
      now: clock.now,
      connectionsLoader: loader,
      prober,
      recentActivityLoader,
      force: true,
    });

    const a = payload.providers.find((p) => p.id === "a");
    const b = payload.providers.find((p) => p.id === "b");
    expect(a.state).toBe("healthy");
    expect(a.recentlyActive).toBe(true);
    expect(a.error).toBeNull();
    // "b" had no recent activity → stays down.
    expect(b.state).toBe("down");
    expect(b.recentlyActive).toBeUndefined();
    expect(payload.summary.healthy).toBe(1);
    expect(payload.summary.down).toBe(1);
  });

  it("never overrides a blocked (SSRF) probe even with recent activity", async () => {
    const clock = fakeClock();
    const loader = async () => [CONN("a")];
    const prober = async () => ({ blocked: true, error: "blocked by SSRF guard" });
    const recentActivityLoader = async () => new Set(["a"]);

    const payload = await getHealthPayload({
      now: clock.now,
      connectionsLoader: loader,
      prober,
      recentActivityLoader,
      force: true,
    });

    expect(payload.providers[0].state).toBe("blocked");
  });

  it("tolerates a failing recent-activity loader (falls back to probe state)", async () => {
    const clock = fakeClock();
    const loader = async () => [CONN("a")];
    const prober = async () => ({ valid: false, status: 503, error: "boom" });
    const recentActivityLoader = async () => { throw new Error("db down"); };

    const payload = await getHealthPayload({
      now: clock.now,
      connectionsLoader: loader,
      prober,
      recentActivityLoader,
      force: true,
    });

    expect(payload.providers[0].state).toBe("down");
  });
});
