import { describe, expect, it } from "vitest";
import { nativeProviderReadiness } from "../../src/shared/utils/nativeProviderReadiness.js";

describe("read-only native provider readiness", () => {
  it("separates listed metadata, configured dispatch and live proof", () => {
    const summary = nativeProviderReadiness("openai");
    expect(summary.catalog).toBe("Listed");
    expect(summary.nativeRoutes).toBe("Configured, not verified");
    expect(summary.kinds).toContain("chat");
    expect(summary.authentication).toBe("UNKNOWN");
    expect(summary.inference).toBe("UNKNOWN");
  });

  it("does not infer a native route from catalog presence", () => {
    const summary = nativeProviderReadiness("codex");
    expect(summary.catalog).toBe("Listed");
    expect(summary.nativeRoutes).toBe("No dedicated native route configured");
    expect(summary.kinds).toEqual([]);
    expect(nativeProviderReadiness("missing-provider").catalog).toBe("Not listed");
  });

  it("includes websocket-only native kinds", () => {
    expect(nativeProviderReadiness("gemini").kinds).toContain("live");
    expect(nativeProviderReadiness("gemini").nativeRoutes).toBe("Configured, not verified");
  });

  it("keeps saved valid and stale records separate from actual inference", () => {
    const connections = Object.freeze([
      Object.freeze({ provider: "openai", testStatus: "active", isActive: true }),
      Object.freeze({ provider: "openai", testStatus: "success", testedAt: "2000-01-01", inference: "PASS" }),
      Object.freeze({ provider: "openai", testStatus: "unavailable", isActive: true }),
      Object.freeze({ provider: "codex", testStatus: "active" }),
    ]);
    const summary = nativeProviderReadiness("openai", connections);
    expect(summary.savedValidation).toBe(2);
    expect(summary.authentication).toBe("UNKNOWN");
    expect(summary.inference).toBe("UNKNOWN");
    expect(connections[2]).toEqual({ provider: "openai", testStatus: "unavailable", isActive: true });
  });
});
