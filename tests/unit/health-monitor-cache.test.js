import { describe, expect, it, beforeEach } from "vitest";
import {
  getHealthPayload,
  invalidateHealthCache,
  getHealthCacheEntry,
  HEALTH_PAYLOAD_TTL_MS,
} from "../../src/lib/healthMonitor.js";

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const CONN = (id, provider = "demo") => ({ id, provider, name: id, isActive: true });

describe("healthMonitor cache", () => {
  beforeEach(() => invalidateHealthCache());

  it("serves cached payload within TTL without re-probing", async () => {
    const clock = fakeClock();
    let probes = 0;
    const loader = async () => [CONN("a")];
    const prober = async () => { probes += 1; return { valid: true, status: 200 }; };

    const p1 = await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });
    const p2 = await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });

    expect(probes).toBe(1);
    expect(p1).toBe(p2);
    expect(p2.summary.healthy).toBe(1);
  });

  it("rebuilds after TTL expires", async () => {
    const clock = fakeClock();
    let probes = 0;
    const loader = async () => [CONN("a")];
    const prober = async () => { probes += 1; return { valid: true, status: 200 }; };

    await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });
    clock.advance(HEALTH_PAYLOAD_TTL_MS + 1);
    await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });

    expect(probes).toBe(2);
  });

  it("DELETE invalidates the cache so the next read rebuilds", async () => {
    const clock = fakeClock();
    let probes = 0;
    const loader = async () => [CONN("a")];
    const prober = async () => { probes += 1; return { valid: true, status: 200 }; };

    await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });
    expect(getHealthCacheEntry()).not.toBeNull();
    invalidateHealthCache();
    expect(getHealthCacheEntry()).toBeNull();
    await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });
    expect(probes).toBe(2);
  });

  it("dedupes concurrent misses into a single build", async () => {
    const clock = fakeClock();
    let builds = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const loader = async () => [CONN("a")];
    const prober = async () => {
      builds += 1;
      await gate;
      return { valid: true, status: 200 };
    };

    const p1 = getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });
    const p2 = getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });
    release();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(builds).toBe(1);
    expect(r1).toBe(r2);
  });

  it("invalidation during an in-flight build prevents stale cache repopulation", async () => {
    const clock = fakeClock();
    let release;
    const gate = new Promise((r) => { release = r; });
    const loader = async () => [CONN("a")];
    const prober = async () => { await gate; return { valid: true, status: 200 }; };

    const inFlight = getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });
    invalidateHealthCache(); // bumps generation while probes are mid-flight
    release();
    await inFlight;

    // Build that started before invalidation must NOT repopulate the cache.
    expect(getHealthCacheEntry()).toBeNull();
  });

  it("force rebuild publishes and a slower normal build cannot overwrite it", async () => {
    const clock = fakeClock();
    let releaseNormal;
    const normalGate = new Promise((r) => { releaseNormal = r; });
    let calls = 0;
    const loader = async () => [CONN("a")];
    const prober = async () => {
      calls += 1;
      if (calls === 1) { await normalGate; return { valid: false, status: 503, error: "down" }; }
      return { valid: true, status: 200 };
    };

    const normal = getHealthPayload({ now: clock.now, connectionsLoader: loader, prober }); // starts, blocks
    const forced = await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober, force: true }); // invalidates + rebuilds
    expect(forced.summary.healthy).toBe(1);
    expect(getHealthCacheEntry()?.payload.summary.healthy).toBe(1);

    releaseNormal(); // older normal build finishes later
    await normal;
    // Must NOT have overwritten the fresher forced result.
    expect(getHealthCacheEntry()?.payload.summary.healthy).toBe(1);
  });

  it("maps 401/403 to degraded, 5xx to down, no status to down", async () => {
    const clock = fakeClock();
    const loader = async () => [CONN("auth"), CONN("outage"), CONN("net"), CONN("ok")];
    const table = {
      auth: { valid: false, status: 401, error: "bad key" },
      outage: { valid: false, status: 503, error: "overloaded" },
      net: { valid: false, status: null, error: "ECONNREFUSED" },
      ok: { valid: true, status: 200 },
    };
    const prober = async (c) => table[c.id];

    const { providers, summary } = await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });
    const byId = Object.fromEntries(providers.map((p) => [p.id, p.state]));

    expect(byId).toEqual({ auth: "degraded", outage: "down", net: "down", ok: "healthy" });
    expect(summary).toMatchObject({ healthy: 1, degraded: 1, down: 2, total: 4 });
  });

  it("marks SSRF-blocked probes as blocked and sanitizes the error", async () => {
    const clock = fakeClock();
    const loader = async () => [CONN("b")];
    const prober = async () => ({
      valid: false,
      status: null,
      blocked: true,
      error: "/home/alice/.9router/key Bearer sk-abc123 blocked",
    });

    const { providers, summary } = await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });
    expect(summary.blocked).toBe(1);
    expect(providers[0].state).toBe("blocked");
    expect(providers[0].error).toBeTruthy();
    expect(providers[0].error).not.toContain("/home/alice");
    expect(providers[0].error).not.toContain("sk-abc123");
  });

  it("maps unconfigured probe result to unconfigured state (never healthy)", async () => {
    const clock = fakeClock();
    const loader = async () => [CONN("a1", "auggie")];
    const prober = async () => ({ valid: false, status: null, unconfigured: true, error: "no HTTP transport to probe" });

    const { providers, summary } = await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober });
    expect(providers[0].state).toBe("unconfigured");
    expect(summary.unconfigured).toBe(1);
    expect(summary.healthy).toBe(0);
    expect(summary.down).toBe(0);
  });
});
