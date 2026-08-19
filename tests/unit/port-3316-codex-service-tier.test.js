// Regression coverage for upstream 9router PR #3316
// "feat(codex): show actual service tier in logs".
//
// formatCodexTierLog reports the *transformed* (effective) service_tier from
// the upstream request body — not the tier the client originally requested —
// since transformRequest may normalize it (fast→priority) or strip it
// entirely for long contexts.
import { describe, expect, it } from "vitest";
import { formatCodexTierLog } from "../../open-sse/executors/codex.js";

describe("port/upstream-3316-codex-service-tier", () => {
  it("reports the effective tier from the transformed body", () => {
    expect(formatCodexTierLog("gpt-5.6-sol", { service_tier: "priority" }))
      .toBe("CODEX | gpt-5.6-sol | TIER:priority");
  });

  it("falls back to default when service_tier is absent", () => {
    expect(formatCodexTierLog("gpt-5.6-sol", { model: "gpt-5.6-sol" }))
      .toBe("CODEX | gpt-5.6-sol | TIER:default");
  });

  it("falls back to default when transformedBody is missing entirely", () => {
    expect(formatCodexTierLog("gpt-5.5", undefined))
      .toBe("CODEX | gpt-5.5 | TIER:default");
  });
});
