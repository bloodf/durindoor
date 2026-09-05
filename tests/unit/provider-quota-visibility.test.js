import { describe, expect, it } from "vitest";
import {
  filterQuotasByVisibility,
  getHiddenQuotaRows,
  updateQuotaVisibility,
  parseQuotaData,
  trimHiddenQuotaKeys,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("provider quota visibility", () => {
  const data = {
    quotas: {
      "gemini-pro-agent": {
        displayName: "Gemini 3.1 Pro (High)",
        used: 200,
        total: 1000,
        resetAt: "2026-07-04T00:00:00Z",
        remainingPercentage: 80,
      },
      "claude-opus-4-6-thinking": {
        displayName: "Claude Opus 4.6 (Thinking)",
        used: 100,
        total: 1000,
        resetAt: "2026-07-04T00:00:00Z",
        remainingPercentage: 90,
      },
    },
  };

  it("groups Antigravity model quotas into Gemini and Claude families", () => {
    const quotas = parseQuotaData("antigravity", data);
    expect(quotas.map((q) => q.modelKey)).toEqual([
      "gemini",
      "claude",
    ]);
    expect(quotas[0].name).toBe("Gemini (Flash / Pro)");
    expect(quotas[1].name).toBe("Claude (Sonnet / Opus)");
  });

  it("shows all quotas by default and hides configured provider rows", () => {
    const quotas = parseQuotaData("antigravity", data);
    expect(filterQuotasByVisibility("antigravity", quotas, {})).toHaveLength(2);

    const visibility = {
      antigravity: { hidden: ["claude"] },
    };
    const visible = filterQuotasByVisibility("antigravity", quotas, visibility);
    const hidden = getHiddenQuotaRows("antigravity", quotas, visibility);

    expect(visible.map((q) => q.modelKey)).toEqual(["gemini"]);
    expect(hidden.map((q) => q.modelKey)).toEqual(["claude"]);
  });

  it("trims stale or obsolete model keys", () => {
    const quotas = parseQuotaData("antigravity", data);
    const trimmed = trimHiddenQuotaKeys(["claude", "stale-model-xyz", "gemini-3.8-flash-low"], quotas);
    expect(trimmed).toEqual(["claude"]);

    const visibility = {
      antigravity: { hidden: ["claude", "stale-model-xyz"] },
    };
    const visible = filterQuotasByVisibility("antigravity", quotas, visibility);
    const hidden = getHiddenQuotaRows("antigravity", quotas, visibility);

    expect(visible.map((q) => q.modelKey)).toEqual(["gemini"]);
    expect(hidden.map((q) => q.modelKey)).toEqual(["claude"]);
  });

  it("does not apply one provider hidden list to another provider", () => {
    const quotas = parseQuotaData("antigravity", data);
    const visibility = {
      codex: { hidden: ["gemini"] },
    };
    expect(filterQuotasByVisibility("antigravity", quotas, visibility)).toHaveLength(2);
  });

  it("isolates hidden rows per connection when writing visibility", () => {
    const quotas = parseQuotaData("antigravity", data);
    const visibility = updateQuotaVisibility(
      {},
      "connection-a",
      "antigravity",
      "claude",
      true,
    );

    expect(visibility).toEqual({
      "connection-a": { hidden: ["claude"] },
    });
    expect(
      filterQuotasByVisibility("connection-a", quotas, visibility, "antigravity").map(
        (quota) => quota.modelKey,
      ),
    ).toEqual(["gemini"]);
    expect(
      filterQuotasByVisibility("connection-b", quotas, visibility, "antigravity"),
    ).toHaveLength(2);
  });

  it("preserves legacy hidden rows during the first connection write", () => {
    const visibility = updateQuotaVisibility(
      { antigravity: { hidden: ["gemini"] } },
      "connection-a",
      "antigravity",
      "claude",
      true,
    );

    expect(visibility.antigravity.hidden).toEqual(["gemini"]);
    expect(visibility["connection-a"].hidden).toEqual([
      "gemini",
      "claude",
    ]);
  });

  it("falls back to legacy provider-keyed hidden rows when connection state is absent", () => {
    const quotas = parseQuotaData("antigravity", data);
    const visibility = {
      antigravity: { hidden: ["claude"] },
    };

    expect(
      filterQuotasByVisibility("connection-a", quotas, visibility, "antigravity").map(
        (quota) => quota.modelKey,
      ),
    ).toEqual(["gemini"]);
    expect(
      getHiddenQuotaRows("connection-a", quotas, visibility, "antigravity").map(
        (quota) => quota.modelKey,
      ),
    ).toEqual(["claude"]);
  });

  it("prunes stale per-model hidden keys when an Antigravity family row is toggled", () => {
    // Image model keys and other families must survive the prune.
    const afterHide = updateQuotaVisibility(
      {
        "connection-a": {
          hidden: ["gemini-3.7-flash-low", "gemini-3.1-flash-image", "claude-opus-4-6-thinking"],
        },
      },
      "connection-a",
      "antigravity",
      "gemini",
      true,
    );
    expect(afterHide["connection-a"].hidden).toEqual([
      "gemini-3.1-flash-image",
      "claude-opus-4-6-thinking",
      "gemini",
    ]);

    const afterShow = updateQuotaVisibility(
      {
        "connection-a": {
          hidden: ["claude", "claude-sonnet-4-6", "claude-opus-4-6-thinking", "gemini"],
        },
      },
      "connection-a",
      "antigravity",
      "claude",
      false,
    );
    expect(afterShow["connection-a"].hidden).toEqual(["gemini"]);
  });

  describe("claude sorted rows", () => {
    // API order differs from the canonical sort order imposed by parseQuotaData.
    const claudeData = {
      quotas: {
        "weekly sonnet (7d)": { used: 10, total: 100 },
        "session (5h)": { used: 1, total: 100 },
        "weekly (7d)": { used: 2, total: 100 },
      },
    };

    it("keys Claude rows by name so sorting cannot invalidate hidden settings", () => {
      const quotas = parseQuotaData("claude", claudeData);
      expect(quotas.map((q) => [q.name, q.modelKey])).toEqual([
        ["session (5h)", "session (5h)"],
        ["weekly (7d)", "weekly (7d)"],
        ["weekly sonnet (7d)", "weekly sonnet (7d)"],
      ]);

      const visibility = updateQuotaVisibility({}, "conn-c", "claude", "weekly sonnet (7d)", true);
      expect(
        filterQuotasByVisibility("conn-c", quotas, visibility, "claude").map((q) => q.name),
      ).toEqual(["session (5h)", "weekly (7d)"]);
    });

    it("still honors legacy name::index keys persisted before the canonical sort", () => {
      const quotas = parseQuotaData("claude", claudeData);
      // Pre-sort builds stored the sonnet row at API-order index 0.
      const visibility = { claude: { hidden: ["weekly sonnet (7d)::0"] } };
      expect(
        filterQuotasByVisibility("conn-c", quotas, visibility, "claude").map((q) => q.name),
      ).toEqual(["session (5h)", "weekly (7d)"]);
      expect(
        getHiddenQuotaRows("conn-c", quotas, visibility, "claude").map((q) => q.name),
      ).toEqual(["weekly sonnet (7d)"]);
    });
  });
});
