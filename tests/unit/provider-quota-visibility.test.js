import { describe, expect, it } from "vitest";
import {
  filterQuotasByVisibility,
  getHiddenQuotaRows,
  updateQuotaVisibility,
  parseQuotaData,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("provider quota visibility", () => {
  const data = {
    quotas: {
      "gemini-pro-agent": {
        displayName: "Gemini 3.1 Pro (High)",
        used: 200,
        total: 1000,
        resetAt: "2026-07-04T00:00:00Z",
      },
      "claude-opus-4-6-thinking": {
        displayName: "Claude Opus 4.6 (Thinking)",
        used: 100,
        total: 1000,
        resetAt: "2026-07-04T00:00:00Z",
      },
    },
  };

  it("keeps Antigravity modelKey so hidden settings use stable quota ids", () => {
    const quotas = parseQuotaData("antigravity", data);
    expect(quotas.map((q) => q.modelKey)).toEqual([
      "gemini-pro-agent",
      "claude-opus-4-6-thinking",
    ]);
  });

  it("shows all quotas by default and hides configured provider rows", () => {
    const quotas = parseQuotaData("antigravity", data);
    expect(filterQuotasByVisibility("antigravity", quotas, {})).toHaveLength(2);

    const visibility = {
      antigravity: { hidden: ["claude-opus-4-6-thinking"] },
    };
    const visible = filterQuotasByVisibility("antigravity", quotas, visibility);
    const hidden = getHiddenQuotaRows("antigravity", quotas, visibility);

    expect(visible.map((q) => q.modelKey)).toEqual(["gemini-pro-agent"]);
    expect(hidden.map((q) => q.modelKey)).toEqual(["claude-opus-4-6-thinking"]);
  });

  it("does not apply one provider hidden list to another provider", () => {
    const quotas = parseQuotaData("antigravity", data);
    const visibility = {
      codex: { hidden: ["gemini-pro-agent"] },
    };
    expect(filterQuotasByVisibility("antigravity", quotas, visibility)).toHaveLength(2);
  });

  it("isolates hidden rows per connection when writing visibility", () => {
    const quotas = parseQuotaData("antigravity", data);
    const visibility = updateQuotaVisibility(
      {},
      "connection-a",
      "antigravity",
      "claude-opus-4-6-thinking",
      true,
    );

    expect(visibility).toEqual({
      "connection-a": { hidden: ["claude-opus-4-6-thinking"] },
    });
    expect(
      filterQuotasByVisibility("connection-a", quotas, visibility, "antigravity").map(
        (quota) => quota.modelKey,
      ),
    ).toEqual(["gemini-pro-agent"]);
    expect(
      filterQuotasByVisibility("connection-b", quotas, visibility, "antigravity"),
    ).toHaveLength(2);
  });

  it("preserves legacy hidden rows during the first connection write", () => {
    const visibility = updateQuotaVisibility(
      { antigravity: { hidden: ["gemini-pro-agent"] } },
      "connection-a",
      "antigravity",
      "claude-opus-4-6-thinking",
      true,
    );

    expect(visibility.antigravity.hidden).toEqual(["gemini-pro-agent"]);
    expect(visibility["connection-a"].hidden).toEqual([
      "gemini-pro-agent",
      "claude-opus-4-6-thinking",
    ]);
  });

  it("falls back to legacy provider-keyed hidden rows when connection state is absent", () => {
    const quotas = parseQuotaData("antigravity", data);
    const visibility = {
      antigravity: { hidden: ["claude-opus-4-6-thinking"] },
    };

    expect(
      filterQuotasByVisibility("connection-a", quotas, visibility, "antigravity").map(
        (quota) => quota.modelKey,
      ),
    ).toEqual(["gemini-pro-agent"]);
    expect(
      getHiddenQuotaRows("connection-a", quotas, visibility, "antigravity").map(
        (quota) => quota.modelKey,
      ),
    ).toEqual(["claude-opus-4-6-thinking"]);
  });
});
