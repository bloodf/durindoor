import { describe, expect, it } from "vitest";
import { evaluateProviderQuotaPreflight } from "../../src/shared/services/providerQuotaPreflight.js";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");
const SOURCE_IDS = {
  codex: "codex:wham-usage:v1",
  github: "github:copilot-user-quota:v1",
  cursor: "cursor:dashboard-spending:v1",
  kiro: "kiro:get-usage-limits:v1",
  glm: "glm:coding-plan-quota:v1",
  "codebuddy-cn": "codebuddy-cn:billing-meter:v1",
  "qoder-cn": "qoder-cn:quota-usage-legacy:v1",
  crof: "crof:usage-api:v1",
  deepseek: "deepseek:balance:v1",
};

function row(provider, {
  resourceKey = "scope:account",
  dimensionKey = "requests:session",
  state = "available",
  resetAt = NOW + 60_000,
  sourceId = SOURCE_IDS[provider],
  sourceType = "provider_api",
} = {}) {
  return {
    identity: { connectionId: "conn", provider, accountKey: "scope:connection", resourceKey, dimensionKey },
    state,
    amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: null, unit: null },
    timing: {
      observedAt: new Date(NOW - 1_000).toISOString(),
      staleAt: new Date(NOW + 120_000).toISOString(),
      resetAt: state === "exhausted" ? new Date(resetAt).toISOString() : null,
      cooldownUntil: state === "cooldown" ? new Date(resetAt).toISOString() : null,
    },
    provenance: { sourceType, sourceId, reasonCode: sourceType === "response_headers" ? "rate_limited" : null, metadata: {} },
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

describe("provider-specific quota gating policies", () => {
  it("treats Kiro subscription and trial as additive pools", () => {
    const exhaustedTrial = row("kiro", { resourceKey: "resource:agentic_request", dimensionKey: "requests:free-trial", state: "exhausted" });
    const subscription = row("kiro", { resourceKey: "resource:agentic_request", dimensionKey: "requests:subscription" });
    expect(decide("kiro", [exhaustedTrial, subscription])).toMatchObject({ skip: false, reason: "available" });
    expect(decide("kiro", [exhaustedTrial, { ...subscription, state: "exhausted", timing: exhaustedTrial.timing }]))
      .toMatchObject({ skip: true, reason: "exhausted" });
  });

  it("requires every CodeBuddy package and DeepSeek currency to be exhausted", () => {
    const codebuddy = [
      row("codebuddy-cn", { resourceKey: "package:monthly", dimensionKey: "credits:capacity", state: "exhausted" }),
      row("codebuddy-cn", { resourceKey: "package:bonus-1", dimensionKey: "credits:capacity" }),
    ];
    expect(decide("codebuddy-cn", codebuddy)).toMatchObject({ skip: false });
    expect(decide("codebuddy-cn", codebuddy.map((item) => ({ ...item, state: "exhausted", timing: codebuddy[0].timing }))))
      .toMatchObject({ skip: true });

    const balances = [
      row("deepseek", { resourceKey: "currency:usd", dimensionKey: "balance:available", state: "exhausted" }),
      row("deepseek", { resourceKey: "currency:cny", dimensionKey: "balance:available" }),
    ];
    expect(decide("deepseek", balances)).toMatchObject({ skip: false });
  });

  it("uses Crof daily requests before pay-as-you-go balance", () => {
    const daily = row("crof", { dimensionKey: "requests:daily", state: "exhausted" });
    const credits = row("crof", { dimensionKey: "balance:usd" });
    expect(decide("crof", [daily, credits])).toMatchObject({ skip: true });
    expect(decide("crof", [credits])).toMatchObject({ skip: false, reason: "available" });
    expect(decide("crof", [{ ...credits, state: "exhausted", timing: daily.timing }])).toMatchObject({ skip: true });
  });

  it("keeps unrelated GitHub and Cursor dashboard buckets informational", () => {
    expect(decide("github", [row("github", { dimensionKey: "requests:completions", state: "exhausted" })]))
      .toMatchObject({ skip: false, reason: "missing" });
    expect(decide("github", [row("github", { dimensionKey: "requests:chat", state: "exhausted" })]))
      .toMatchObject({ skip: true });
    expect(decide("cursor", [row("cursor", { dimensionKey: "requests:auto-composer", state: "exhausted" })]))
      .toMatchObject({ skip: false });
    expect(decide("cursor", [row("cursor", { dimensionKey: "requests:api", state: "exhausted" })]))
      .toMatchObject({ skip: true });
  });

  it("gates GLM token windows but not tool quotas", () => {
    const project = "project:h-0123456789abcdef0123456789abcdef";
    expect(decide("glm", [row("glm", { resourceKey: project, dimensionKey: "tokens:weekly", state: "exhausted" })]))
      .toMatchObject({ skip: true });
    expect(decide("glm", [row("glm", { resourceKey: project, dimensionKey: "tools:monthly", state: "exhausted" })]))
      .toMatchObject({ skip: false });
  });

  it("treats Qoder user and organization pools as alternatives", () => {
    const user = row("qoder-cn", { resourceKey: "scope:user", dimensionKey: "credits:plan", state: "exhausted" });
    const organization = row("qoder-cn", { resourceKey: "scope:organization", dimensionKey: "credits:plan" });
    expect(decide("qoder-cn", [user, organization])).toMatchObject({ skip: false });
    expect(decide("qoder-cn", [user, { ...organization, state: "exhausted", timing: user.timing }]))
      .toMatchObject({ skip: true });
  });

  it("prefers scoped Codex quota over its generic account window", () => {
    const account = row("codex", { state: "exhausted" });
    const review = row("codex", { resourceKey: "feature:code-review", state: "available" });
    expect(decide("codex", [account, review], ["feature:code-review"])).toMatchObject({ skip: false, reason: "available" });
    expect(decide("codex", [account], ["feature:code-review"])).toMatchObject({ skip: true });
  });

  it("lets runtime blockers override additive provider data and rejects foreign sources", () => {
    const positive = row("kiro", { resourceKey: "resource:agentic_request", dimensionKey: "requests:subscription" });
    const runtime = row("kiro", {
      resourceKey: "model:claude-sonnet-4",
      dimensionKey: "requests:runtime",
      state: "cooldown",
      sourceType: "response_headers",
      sourceId: "kiro:runtime:v1",
    });
    expect(decide("kiro", [positive, runtime], ["model:claude-sonnet-4"])).toMatchObject({ skip: true, reason: "cooldown" });
    const foreign = row("kiro", { resourceKey: "resource:agentic_request", state: "exhausted", sourceId: "kiro:foreign:v1" });
    expect(decide("kiro", [foreign])).toMatchObject({ skip: false, reason: "missing" });
  });
});
