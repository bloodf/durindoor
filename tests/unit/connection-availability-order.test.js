import { describe, expect, it } from "vitest";

import {
  getEffectiveConnectionStatus,
  isConnectionAvailable,
  sortConnectionsByAvailability,
} from "../../src/shared/utils/connectionAvailability.js";

const NOW = new Date("2026-07-16T12:00:00Z").getTime();
const FUTURE = new Date(NOW + 60_000).toISOString();
const PAST = new Date(NOW - 60_000).toISOString();

describe("getEffectiveConnectionStatus", () => {
  it("treats unavailable without a live modelLock cooldown as active", () => {
    expect(getEffectiveConnectionStatus({ testStatus: "unavailable" }, NOW)).toBe("active");
    expect(getEffectiveConnectionStatus({ testStatus: "unavailable", modelLock_gpt4: PAST }, NOW)).toBe("active");
    expect(getEffectiveConnectionStatus({ testStatus: "unavailable", modelLock_gpt4: null }, NOW)).toBe("active");
  });

  it("keeps unavailable when a modelLock cooldown is still in the future", () => {
    expect(getEffectiveConnectionStatus({ testStatus: "unavailable", modelLock_gpt4: FUTURE }, NOW)).toBe("unavailable");
  });

  it("passes other statuses through unchanged", () => {
    expect(getEffectiveConnectionStatus({ testStatus: "active" }, NOW)).toBe("active");
    expect(getEffectiveConnectionStatus({ testStatus: "error", modelLock_gpt4: FUTURE }, NOW)).toBe("error");
    expect(getEffectiveConnectionStatus({}, NOW)).toBeUndefined();
  });
});

describe("isConnectionAvailable", () => {
  it("is true for active and success", () => {
    expect(isConnectionAvailable({ testStatus: "active" }, NOW)).toBe(true);
    expect(isConnectionAvailable({ testStatus: "success" }, NOW)).toBe(true);
  });

  it("is false for error, and for unavailable under a live cooldown", () => {
    expect(isConnectionAvailable({ testStatus: "error" }, NOW)).toBe(false);
    expect(isConnectionAvailable({ testStatus: "unavailable", modelLock_x: FUTURE }, NOW)).toBe(false);
  });

  it("is false for a disabled connection even with a healthy last probe", () => {
    // Disabled rows cannot serve requests now; a stale active/success
    // testStatus must not classify them as available.
    expect(isConnectionAvailable({ testStatus: "active", isActive: false }, NOW)).toBe(false);
    expect(isConnectionAvailable({ testStatus: "success", isActive: false }, NOW)).toBe(false);
  });

  it("treats a missing isActive as enabled", () => {
    expect(isConnectionAvailable({ testStatus: "active", isActive: undefined }, NOW)).toBe(true);
    expect(isConnectionAvailable({ testStatus: "active", isActive: true }, NOW)).toBe(true);
  });
});

describe("sortConnectionsByAvailability", () => {
  it("moves available connections first while preserving manual order within each group (stable ties)", () => {
    const connections = [
      { id: "a", testStatus: "error" },
      { id: "b", testStatus: "success" },
      { id: "c", testStatus: "unavailable" }, // no cooldown → effectively active
      { id: "d", testStatus: "error" },
      { id: "e", testStatus: "active" },
      { id: "f", testStatus: "unavailable", modelLock_gpt4: FUTURE }, // live cooldown → unavailable
    ];

    const sorted = sortConnectionsByAvailability(connections, NOW);

    expect(sorted.map((c) => c.id)).toEqual(["b", "c", "e", "a", "d", "f"]);
  });

  it("keeps the input order when availability is uniform", () => {
    const connections = [
      { id: "a", testStatus: "active" },
      { id: "b", testStatus: "success" },
      { id: "c", testStatus: "unavailable" },
    ];

    expect(sortConnectionsByAvailability(connections, NOW).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const connections = [
      { id: "a", testStatus: "error" },
      { id: "b", testStatus: "active" },
    ];

    sortConnectionsByAvailability(connections, NOW);

    expect(connections.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("sorts disabled connections into the unavailable group behind enabled-healthy ones", () => {
    const connections = [
      { id: "disabled-healthy", testStatus: "success", isActive: false },
      { id: "enabled-healthy", testStatus: "active", isActive: true },
      { id: "enabled-unhealthy", testStatus: "error", isActive: true },
    ];

    const sorted = sortConnectionsByAvailability(connections, NOW);

    expect(sorted.map((c) => c.id)).toEqual(["enabled-healthy", "disabled-healthy", "enabled-unhealthy"]);
  });
});
