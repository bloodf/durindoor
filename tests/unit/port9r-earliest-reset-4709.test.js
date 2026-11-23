import { describe, expect, it } from "vitest";
import { pickEarliestResetConnection } from "../../src/shared/services/quotaSelection.js";

const now = Date.parse("2026-11-22T12:00:00Z");
const accounts = [{ id: "first", priority: 1 }, { id: "second", priority: 2 }];
const decision = (resetAt, freshness = "fresh") => ({ quotaProfile: {
  freshness, routingWindows: [{ resetAt }],
} });

describe("earliest reset account selection", () => {
  it("chooses the soonest future reset over priority", () => {
    const decisions = new Map([["first", decision("2026-11-22T15:00:00Z")], ["second", decision("2026-11-22T13:00:00Z")]]);
    expect(pickEarliestResetConnection(accounts, decisions, now).id).toBe("second");
  });

  it("falls back to priority for unknown, stale, or expired resets", () => {
    const decisions = new Map([["first", decision("2026-11-22T11:00:00Z")], ["second", decision("2026-11-22T13:00:00Z", "stale")]]);
    expect(pickEarliestResetConnection([...accounts].reverse(), decisions, now).id).toBe("first");
    expect(pickEarliestResetConnection(accounts, new Map(), now).id).toBe("first");
  });
});

it("isolates requested models and keeps exhaustion gates", async () => {
  const { evaluateProviderQuotaPreflight } = await import("../../src/shared/services/providerQuotaPreflight.js");
  const snapshot = (resourceKey, state) => ({
    identity: { connectionId: "first", provider: "codex", accountKey: "scope:connection", resourceKey, dimensionKey: "requests:runtime" },
    state, amounts: { remainingRatio: state === "exhausted" ? 0 : 0.5 },
    timing: { observedAt: new Date(now - 1000).toISOString(), staleAt: new Date(now + 60000).toISOString(), resetAt: "2026-11-22T13:00:00Z" },
    provenance: { sourceType: "provider_api", sourceId: "codex:wham-usage:v1" },
  });
  const rows = [snapshot("model:a", "available"), snapshot("model:b", "exhausted")];
  const evaluate = (model) => evaluateProviderQuotaPreflight(rows, { connectionId: "first", provider: "codex", resourceKeys: [`model:${model}`], now });
  expect(evaluate("a").quotaProfile.routingWindows[0].resetAt).toBe("2026-11-22T13:00:00Z");
  expect(evaluate("a").skip).toBe(false);
  expect(evaluate("b").skip).toBe(true);
  expect(evaluate("c").quotaProfile).toBeFalsy();
});

it("ignores stale reset timestamps even when they sort first", () => {
  const decisions = new Map([["first", decision("2026-11-22T12:01:00Z", "stale")], ["second", decision("2026-11-22T13:00:00Z")]]);
  expect(pickEarliestResetConnection(accounts, decisions, now).id).toBe("second");
});
