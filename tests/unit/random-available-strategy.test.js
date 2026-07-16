import { describe, expect, it } from "vitest";
import { pickRandomAvailableConnection } from "../../open-sse/services/accountFallback.js";

const NOW = new Date("2026-07-16T12:00:00Z").getTime();
const future = (mins) => new Date(NOW + mins * 60_000).toISOString();
const past = (mins) => new Date(NOW - mins * 60_000).toISOString();

const conn = (id, testStatus, extra = {}) => ({ id, testStatus, ...extra });

describe("pickRandomAvailableConnection (random-available strategy)", () => {
  it("picks the first healthy candidate when rng() is 0", () => {
    const candidates = [conn("a", "active"), conn("b", "success")];
    expect(pickRandomAvailableConnection(candidates, { rng: () => 0, now: NOW })?.id).toBe("a");
  });

  it("picks the last healthy candidate when rng() approaches 1", () => {
    const candidates = [conn("a", "active"), conn("b", "success"), conn("c", "active")];
    expect(pickRandomAvailableConnection(candidates, { rng: () => 0.999999, now: NOW })?.id).toBe("c");
  });

  it("excludes connections still in cooldown", () => {
    const candidates = [conn("a", "active", { rateLimitedUntil: future(5) }), conn("b", "success")];
    // rng 0 would pick "a" if cooldown were ignored
    expect(pickRandomAvailableConnection(candidates, { rng: () => 0, now: NOW })?.id).toBe("b");
  });

  it("excludes unavailable and error statuses rather than remapping them", () => {
    const candidates = [
      conn("u", "unavailable"),
      conn("e", "error"),
      conn("f", "failed"),
      conn("ok", "success"),
    ];
    expect(pickRandomAvailableConnection(candidates, { rng: () => 0, now: NOW })?.id).toBe("ok");
  });

  it("treats an expired cooldown as available again", () => {
    const candidates = [conn("a", "active", { rateLimitedUntil: past(5) }), conn("b", "success")];
    expect(pickRandomAvailableConnection(candidates, { rng: () => 0, now: NOW })?.id).toBe("a");
  });

  it("returns null when no healthy candidate exists", () => {
    const candidates = [
      conn("u", "unavailable"),
      conn("c", "active", { rateLimitedUntil: future(30) }),
    ];
    expect(pickRandomAvailableConnection(candidates, { rng: () => 0.5, now: NOW })).toBeNull();
  });

  it("returns null for empty or missing candidates", () => {
    expect(pickRandomAvailableConnection([], { rng: () => 0, now: NOW })).toBeNull();
    expect(pickRandomAvailableConnection(null, { rng: () => 0, now: NOW })).toBeNull();
  });

  it("selects uniformly across the healthy subset", () => {
    const candidates = [conn("bad", "unavailable"), conn("a", "active"), conn("b", "success")];
    // Healthy subset has size 2; midpoint rng values must land on distinct members.
    expect(pickRandomAvailableConnection(candidates, { rng: () => 0.25, now: NOW })?.id).toBe("a");
    expect(pickRandomAvailableConnection(candidates, { rng: () => 0.75, now: NOW })?.id).toBe("b");
  });
});
