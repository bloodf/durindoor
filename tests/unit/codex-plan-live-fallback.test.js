// decolua/9router#3210 — the plan badge must prefer the LIVE quota plan and fall
// back to the connection's stored OAuth metadata. Before this port, neither view
// did that: the quota view read only `quota.plan` and the connection row read
// only stored `chatgptPlanType`, so an unavailable or "unknown" live read showed
// no badge at all even though a usable stored value existed.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  getCodexPlan,
  toCodexPlanEntry,
  buildCodexPlanMap,
} from "../../src/shared/utils/codexPlanLabel.js";

const stored = (plan) => ({ providerSpecificData: { chatgptPlanType: plan } });

describe("getCodexPlan: live-first with stored fallback", () => {
  it("prefers the live quota plan over stored metadata", () => {
    expect(getCodexPlan({ plan: "Pro" }, stored("Plus"))).toBe("Pro");
  });

  // The stored value is only written at authorization time, so it goes stale
  // after an upgrade — but it beats rendering nothing.
  it("falls back to stored metadata when the live plan is missing", () => {
    expect(getCodexPlan({}, stored("Plus"))).toBe("Plus");
    expect(getCodexPlan(null, stored("Plus"))).toBe("Plus");
    expect(getCodexPlan(undefined, stored("Plus"))).toBe("Plus");
  });

  it("falls back when the live plan is the unknown placeholder", () => {
    for (const raw of ["unknown", "Unknown", "UNKNOWN"]) {
      expect(getCodexPlan({ plan: raw }, stored("Plus")), raw).toBe("Plus");
    }
  });

  it("falls back when the live plan is empty or whitespace", () => {
    expect(getCodexPlan({ plan: "" }, stored("Plus"))).toBe("Plus");
    expect(getCodexPlan({ plan: "   " }, stored("Plus"))).toBe("Plus");
  });

  it("renders no badge when neither source has a usable plan", () => {
    expect(getCodexPlan({ plan: "unknown" }, stored("unknown"))).toBe("");
    expect(getCodexPlan({}, {})).toBe("");
    expect(getCodexPlan(null, null)).toBe("");
  });

  it("trims both sources", () => {
    expect(getCodexPlan({ plan: "  Pro  " }, stored("Plus"))).toBe("Pro");
    expect(getCodexPlan({}, stored("  Plus  "))).toBe("Plus");
  });

  it("ignores non-string plan values on either side", () => {
    expect(getCodexPlan({ plan: 42 }, stored("Plus"))).toBe("Plus");
    expect(getCodexPlan({ plan: { tier: "Pro" } }, stored("Plus"))).toBe("Plus");
    expect(getCodexPlan({}, { providerSpecificData: { chatgptPlanType: 7 } })).toBe("");
  });
});

// The provider page maps each connection's live usage payload through these
// helpers. Importing the production functions — rather than mirroring their
// logic here — is what makes this coverage load-bearing: deleting the page's
// use of them, or changing their behavior, turns these red.
describe("provider page live plan collection", () => {
  it("keeps only real plans", () => {
    expect(toCodexPlanEntry("c1", { plan: "Pro" })).toEqual(["c1", "Pro"]);
    expect(toCodexPlanEntry("c1", { plan: "  Team  " })).toEqual(["c1", "Team"]);
  });

  it("drops unknown, empty, missing, and non-string plans", () => {
    expect(toCodexPlanEntry("c1", { plan: "unknown" })).toBeNull();
    expect(toCodexPlanEntry("c1", { plan: "" })).toBeNull();
    expect(toCodexPlanEntry("c1", {})).toBeNull();
    expect(toCodexPlanEntry("c1", null)).toBeNull();
    expect(toCodexPlanEntry("c1", { plan: 5 })).toBeNull();
  });

  it("builds a connectionId to plan map from the surviving entries", () => {
    const entries = [
      toCodexPlanEntry("c1", { plan: "Pro" }),
      toCodexPlanEntry("c2", { plan: "unknown" }),
      toCodexPlanEntry("c3", { plan: "Plus" }),
    ];

    expect(buildCodexPlanMap(entries)).toEqual({ c1: "Pro", c3: "Plus" });
  });

  it("yields an empty map when nothing is renderable", () => {
    expect(buildCodexPlanMap([null, null])).toEqual({});
    expect(buildCodexPlanMap([])).toEqual({});
  });
});

// The page must actually call these helpers; a hand-rolled inline mapping would
// drift from the shared visibility rule the quota view uses.
describe("provider page wiring", () => {
  it("imports the shared helpers and passes the plan into ConnectionRow", () => {
    const page = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url),
      "utf8",
    );

    expect(page).toContain("toCodexPlanEntry");
    expect(page).toContain("buildCodexPlanMap");
    // Shared util, not dashboard-internal ProviderLimits state.
    expect(page).toContain('from "@/shared/utils/codexPlanLabel"');
    expect(page).not.toContain("ProviderLimits/utils");
    expect(page).toMatch(/plan=\{codexPlans\[conn\.id\]\}/);
    expect(page).toContain("/api/usage/");
  });

  // A provider switch must not leave the previous provider's rows on screen
  // while the new fetch is in flight — a stale response is discarded by the
  // generation guard, so nothing else would clear them.
  it("clears connections and plans when the provider changes", () => {
    const page = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url),
      "utf8",
    );

    const effect = page.slice(page.indexOf("currentProviderIdRef.current = providerId;"));
    const body = effect.slice(0, effect.indexOf("}, [providerId]);"));
    expect(body).toContain("setConnections([])");
    expect(body).toContain("setCodexPlans({})");
    expect(body).toContain("setProviderApiKeyConnectionNames([])");
    expect(body).toContain("setLoading(true)");
  });

  it("gives ConnectionRow a plan prop that prefers live over stored", () => {
    const row = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js", import.meta.url),
      "utf8",
    );

    expect(row).toMatch(/plan = null/);
    expect(row).toMatch(/getCodexPlanLabel\(true, plan\)/);
    expect(row).toContain("chatgptPlanType");
  });
});
