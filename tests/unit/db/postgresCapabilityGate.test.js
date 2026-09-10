import { describe, it, expect } from "vitest";
import {
  evaluateCapabilities,
  isFeatureEnabled,
  listOperatorDisabled,
  DEFAULT_FEATURES,
} from "@/lib/db/postgresCapabilityGate.js";

const cluster = (major) => ({
  serverVersionNum: String(major * 10000 + 4).padStart(6, "0"),
  serverVersion: `${major}.4`,
});

describe("postgresCapabilityGate — evaluateCapabilities", () => {
  it("reports the cluster's major version and a non-mismatch when cap <= cluster", () => {
    const out = evaluateCapabilities(cluster(18), 18, DEFAULT_FEATURES);
    expect(out.clusterMajor).toBe(18);
    expect(out.versionCap).toBe(18);
    expect(out.versionMismatch).toBe(false);
  });

  it("flags a version mismatch when cap > cluster", () => {
    const out = evaluateCapabilities(cluster(17), 18, DEFAULT_FEATURES);
    expect(out.clusterMajor).toBe(17);
    expect(out.versionCap).toBe(18);
    expect(out.versionMismatch).toBe(true);
  });

  it("disables >=18 features on a 16 cluster", () => {
    const out = evaluateCapabilities(cluster(16), 16, DEFAULT_FEATURES);
    expect(out.effective.aio.enabled).toBe(false);
    expect(out.effective.skipScan.enabled).toBe(false);
    expect(out.effective.parallelGin.enabled).toBe(false); // >=17
  });

  it("enables 17+ features on a 17 cluster but not 18-only ones", () => {
    const out = evaluateCapabilities(cluster(17), 17, DEFAULT_FEATURES);
    expect(out.effective.parallelGin.enabled).toBe(true);
    expect(out.effective.streamingIo.enabled).toBe(true);
    expect(out.effective.aio.enabled).toBe(false);
    expect(out.effective.skipScan.enabled).toBe(false);
  });

  it("enables all 18 features on an 18 cluster with the default feature map", () => {
    const out = evaluateCapabilities(cluster(18), 18, DEFAULT_FEATURES);
    for (const [id, e] of Object.entries(out.effective)) {
      if (e.requiresMajor <= 18 && id !== "uuidv7") {
        expect(e.enabled, `${id} should be enabled`).toBe(true);
      } else if (id === "uuidv7") {
        expect(e.enabled, "uuidv7 default-disabled").toBe(false);
      }
    }
  });

  it("respects the operator's per-feature toggle (AIO off on PG 18)", () => {
    const custom = {
      ...DEFAULT_FEATURES,
      aio: { enabled: false, requires: ">=18" },
    };
    const out = evaluateCapabilities(cluster(18), 18, custom);
    expect(out.effective.aio.enabled).toBe(false);
  });

  it("returns false for unknown feature ids via isFeatureEnabled", () => {
    expect(isFeatureEnabled("nope", cluster(18), 18, DEFAULT_FEATURES)).toBe(false);
  });

  it("ignores features the cluster cannot satisfy even if the operator enabled them", () => {
    const custom = {
      ...DEFAULT_FEATURES,
      aio: { enabled: true, requires: ">=18" },
    };
    const out = evaluateCapabilities(cluster(16), 16, custom);
    expect(out.effective.aio.enabled).toBe(false);
  });
});

describe("postgresCapabilityGate — listOperatorDisabled", () => {
  it("lists features the operator turned off even though the cluster supports them", () => {
    const custom = {
      ...DEFAULT_FEATURES,
      aio: { enabled: false, requires: ">=18" },
      parallelGin: { enabled: false, requires: ">=17" },
    };
    const out = listOperatorDisabled(cluster(18), 18, custom);
    expect(out).toContain("aio");
    expect(out).toContain("parallelGin");
    expect(out).not.toContain("uuidv7"); // default off, not operator-disabled
  });

  it("returns an empty list when every feature is at its default", () => {
    const out = listOperatorDisabled(cluster(18), 18, DEFAULT_FEATURES);
    expect(out).toEqual([]);
  });
});

describe("postgresCapabilityGate — feature matrix coverage", () => {
  it("every entry in DEFAULT_FEATURES is exercised against cluster 16, 17, 18, 19 (forward)", () => {
    for (const major of [16, 17, 18, 19]) {
      const out = evaluateCapabilities(cluster(major), major, DEFAULT_FEATURES);
      // every entry must have a numeric requiresMajor
      for (const e of Object.values(out.effective)) {
        expect(e.requiresMajor).toBeGreaterThanOrEqual(16);
        expect(e.requiresMajor).toBeLessThanOrEqual(19);
      }
    }
  });
});
