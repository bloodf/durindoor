import { describe, expect, it } from "vitest";
import { evaluateProviderQuotaPreflight } from "../../src/shared/services/providerQuotaPreflight.js";
import { rankQuotaConnections } from "../../src/shared/services/quotaSelection.js";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");
const SOURCES = {
  kiro: "kiro:get-usage-limits:v1",
  codex: "codex:wham-usage:v1",
  "gemini-cli": "gemini-cli:retrieve-user-quota:v1",
  antigravity: "antigravity:retrieve-user-quota:v1",
  glm: "glm:coding-plan-quota:v1",
};

function row(provider, {
  resourceKey = "scope:account",
  dimensionKey = "requests:session",
  remaining = 50,
  limit = 100,
  state = remaining === 0 ? "exhausted" : "available",
  staleAt = NOW + 60_000,
  unit = dimensionKey.split(":", 1)[0],
} = {}) {
  return {
    identity: { connectionId: "conn", provider, accountKey: "scope:connection", resourceKey, dimensionKey },
    state,
    amounts: {
      limitKind: "bounded",
      limit,
      used: limit - remaining,
      remaining,
      remainingRatio: remaining / limit,
      unit,
    },
    timing: {
      observedAt: new Date(NOW - 1_000).toISOString(),
      staleAt: new Date(staleAt).toISOString(),
      resetAt: new Date(NOW + 60_000).toISOString(),
      cooldownUntil: null,
    },
    provenance: { sourceType: "provider_api", sourceId: SOURCES[provider], reasonCode: null, metadata: {} },
  };
}

function decide(provider, rows, resourceKeys = []) {
  return evaluateProviderQuotaPreflight(rows, {
    connectionId: "conn",
    provider,
    resourceKeys,
    now: NOW,
    refreshSupported: true,
  });
}

describe("quota preflight reservation plans", () => {
  it("builds one atomic bundle for all-required request windows", () => {
    const decision = decide("gemini-cli", [
      row("gemini-cli", { resourceKey: "model:gemini-pro", dimensionKey: "requests:session", remaining: 30 }),
      row("gemini-cli", { resourceKey: "model:gemini-pro", dimensionKey: "requests:weekly", remaining: 80 }),
    ], ["model:gemini-pro"]);
    expect(decision.quotaProfile).toMatchObject({ tracked: true, gateMode: "all-required", effectiveRatio: 0.3 });
    expect(decision.quotaProfile.comparisonKey).toBe(
      "all-required|model:requests:session:requests+model:requests:weekly:requests",
    );
    expect(decision.quotaProfile.reservationAlternatives).toHaveLength(1);
    expect(decision.quotaProfile.reservationAlternatives[0].map((item) => item.dimensionKey).sort())
      .toEqual(["requests:session", "requests:weekly"]);
  });

  it("keeps Kiro additive pools as separate any-sufficient alternatives", () => {
    const decision = decide("kiro", [
      row("kiro", { resourceKey: "resource:agentic_request", dimensionKey: "requests:free-trial", remaining: 10 }),
      row("kiro", { resourceKey: "resource:agentic_request", dimensionKey: "requests:subscription", remaining: 70 }),
    ]);
    expect(decision.quotaProfile).toMatchObject({ tracked: true, gateMode: "any-sufficient", effectiveRatio: 0.7 });
    expect(decision.quotaProfile.reservationAlternatives).toHaveLength(2);
    expect(decision.quotaProfile.reservationAlternatives.every((bundle) => bundle.length === 1)).toBe(true);
  });

  it("uses only the first-present Codex selector", () => {
    const decision = decide("codex", [
      row("codex", { resourceKey: "feature:code-review", dimensionKey: "requests:review", remaining: 20 }),
      row("codex", { resourceKey: "scope:account", dimensionKey: "requests:weekly", remaining: 90 }),
    ], ["feature:code-review"]);
    expect(decision.quotaProfile.gateMode).toBe("first-present");
    expect(decision.quotaProfile.reservationAlternatives[0].map((item) => item.dimensionKey)).toEqual(["requests:review"]);
  });

  it("does not invent request reservations for token or incompatible-unit windows", () => {
    const tokenDecision = decide("glm", [
      row("glm", { dimensionKey: "tokens:session", unit: "tokens", remaining: 50 }),
    ]);
    expect(tokenDecision.quotaProfile).toMatchObject({ tracked: true, reservationAlternatives: [] });
    expect(tokenDecision.quotaProfile.comparisonKey).toBe("all-required|scope:account:tokens:session:tokens");
    const wrongUnit = decide("kiro", [
      row("kiro", { resourceKey: "resource:agentic_request", dimensionKey: "requests:subscription", unit: "credits", remaining: 50 }),
    ]);
    expect(wrongUnit.quotaProfile.reservationAlternatives).toEqual([]);
    expect(wrongUnit.quotaProfile.comparisonKey).toBe("any-sufficient|resource:requests:subscription:credits");
  });

  it("fails open for a mixed-unit any-sufficient pool", () => {
    const decision = decide("kiro", [
      row("kiro", {
        resourceKey: "resource:agentic_request",
        dimensionKey: "requests:free-trial",
        unit: "requests",
        remaining: 1,
      }),
      row("kiro", {
        resourceKey: "resource:agentic_request",
        dimensionKey: "requests:subscription",
        unit: "credits",
        remaining: 50,
      }),
    ]);

    expect(decision.quotaProfile).toMatchObject({ tracked: true, gateMode: "any-sufficient" });
    expect(decision.quotaProfile.reservationAlternatives).toEqual([]);
  });

  it("reserves the bounded-request subset of a mixed all-required gate", () => {
    const decision = decide("gemini-cli", [
      row("gemini-cli", {
        resourceKey: "model:gemini-pro",
        dimensionKey: "requests:session",
        unit: "requests",
        remaining: 20,
      }),
      row("gemini-cli", {
        resourceKey: "model:gemini-pro",
        dimensionKey: "requests:weekly",
        unit: "credits",
        remaining: 70,
      }),
    ], ["model:gemini-pro"]);

    expect(decision.quotaProfile.reservationAlternatives).toHaveLength(1);
    expect(decision.quotaProfile.reservationAlternatives[0].map((item) => item.dimensionKey))
      .toEqual(["requests:session"]);
    expect(decision.quotaProfile.comparisonKey).toBe(
      "all-required|model:requests:session:requests+model:requests:weekly:credits",
    );
  });

  it("uses the same explicit cohort for equivalent cross-provider resource classes", () => {
    const gemini = decide("gemini-cli", [
      row("gemini-cli", { resourceKey: "model:gemini-pro", dimensionKey: "requests:session" }),
    ], ["model:gemini-pro"]);
    const antigravity = decide("antigravity", [
      row("antigravity", { resourceKey: "model:claude-sonnet", dimensionKey: "requests:session" }),
    ], ["model:claude-sonnet"]);

    expect(gemini.quotaProfile.comparisonKey).toBe(antigravity.quotaProfile.comparisonKey);
  });

  it("applies window overrides to every all-required ratio", () => {
    const decision = decide("gemini-cli", [
      row("gemini-cli", { resourceKey: "model:gemini-pro", dimensionKey: "requests:session", remaining: 10 }),
      row("gemini-cli", { resourceKey: "model:gemini-pro", dimensionKey: "requests:weekly", remaining: 90 }),
    ], ["model:gemini-pro"]);
    const [ranked] = rankQuotaConnections(
      [{ id: "conn", provider: "gemini-cli", isActive: true, priority: 1 }],
      new Map([["conn", decision]]),
      new Map(),
      {
        provider: "gemini-cli",
        now: NOW,
        config: {
          providers: {
            "gemini-cli": {
              dimensions: {
                "requests:session": { routingFloorEnabled: true, routingFloorRatio: 0.2 },
              },
            },
          },
        },
      },
    );

    expect(ranked.quotaDecision).toMatchObject({ eligible: false, comparable: true });
    expect(ranked.quotaDecision.reasons).toContain("below_routing_floor");
  });

  it("keeps an any-sufficient pool eligible when one window remains above floor", () => {
    const decision = decide("kiro", [
      row("kiro", { resourceKey: "resource:agentic_request", dimensionKey: "requests:free-trial", remaining: 10 }),
      row("kiro", { resourceKey: "resource:agentic_request", dimensionKey: "requests:subscription", remaining: 90 }),
    ]);
    const [ranked] = rankQuotaConnections(
      [{ id: "conn", provider: "kiro", isActive: true, priority: 1 }],
      new Map([["conn", decision]]),
      new Map(),
      {
        provider: "kiro",
        now: NOW,
        config: { routingFloorEnabled: true, routingFloorRatio: 0.2 },
      },
    );

    expect(ranked.quotaDecision).toMatchObject({ eligible: true, comparable: true });
    expect(ranked.quotaDecision.reasons).not.toContain("below_routing_floor");
  });

  it("does not create a plan from stale rows", () => {
    const decision = decide("kiro", [
      row("kiro", { resourceKey: "resource:agentic_request", dimensionKey: "requests:subscription", staleAt: NOW }),
    ]);
    expect(decision.quotaProfile).toBeNull();
    expect(decision).toMatchObject({ eligible: true, reason: "stale" });
  });
});
