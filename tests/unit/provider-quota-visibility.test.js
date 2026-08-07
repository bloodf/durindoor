import { describe, expect, it } from "vitest";
import {
  filterQuotasByVisibility,
  getQuotaTableRows,
  getRemainingPercentage,
  getHiddenQuotaRows,
  toggleQuotaTableCollapsed,
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
});

describe("quota table collapse and ordering", () => {
  it("sorts descending, collapses each collection to two rows, and transitions independently", () => {
    let firstCollapsed = true;
    let secondCollapsed = true;
    const firstQuotas = [
      { name: "Low", used: 90, total: 100 },
      { name: "High", used: 10, total: 100 },
      { name: "Middle", used: 40, total: 100 },
    ];
    const first = getQuotaTableRows(firstQuotas, "default", firstCollapsed);
    const secondQuotas = [
      { name: "Last", used: 90, total: 100 },
      { name: "First", used: 0, total: 100 },
      { name: "Second", used: 25, total: 100 },
      { name: "Third", used: 50, total: 100 },
    ];
    const second = getQuotaTableRows(secondQuotas, "default", secondCollapsed);

    expect(first.rows.map(({ name }) => name)).toEqual(["High", "Middle"]);
    expect(first.control).toEqual({
      ariaExpanded: false,
      ariaLabel: "Show all quota rows",
      label: "Show 1 more",
      icon: "expand_more",
    });
    expect(second.rows.map(({ name }) => name)).toEqual(["First", "Second"]);
    expect(second.control).toEqual({
      ariaExpanded: false,
      ariaLabel: "Show all quota rows",
      label: "Show 2 more",
      icon: "expand_more",
    });

    secondCollapsed = toggleQuotaTableCollapsed(secondCollapsed);
    const expandedSecond = getQuotaTableRows(secondQuotas, "default", secondCollapsed);
    expect(expandedSecond.rows.map(({ name }) => name)).toEqual(["First", "Second", "Third", "Last"]);
    expect(expandedSecond.control).toEqual({
      ariaExpanded: true,
      ariaLabel: "Show fewer quota rows",
      label: "Show less",
      icon: "expand_less",
    });
    expect(secondCollapsed).toBe(false);
    expect(firstCollapsed).toBe(true);
    expect(getQuotaTableRows(firstQuotas, "default", firstCollapsed)).toEqual(first);
  });

});

describe("Codex quota metadata", () => {
  it("preserves window duration through parsing and table row selection", () => {
    const quotas = parseQuotaData("codex", {
      quotas: {
        session: { used: 7, total: 100, windowSeconds: 18000 },
        weekly: { used: 19, total: 100, windowSeconds: 604800 },
      },
    });

    expect(quotas.map(({ name, windowSeconds }) => ({ name, windowSeconds }))).toEqual([
      { name: "session", windowSeconds: 18000 },
      { name: "weekly", windowSeconds: 604800 },
    ]);
    expect(getQuotaTableRows(quotas).sorted.map(({ windowSeconds }) => windowSeconds))
      .toEqual([18000, 604800]);
  });
});

describe("Qoder organization quota visibility", () => {
  const resetAt = "2026-07-31T16:00:00.000Z";

  it.each([
    ["total", { total: 1, used: 0, remaining: 0 }, 1],
    ["used", { total: 0, used: 20000, remaining: 0 }, 20000],
    ["remaining", { total: 0, used: 0, remaining: 1 }, 1],
  ])("keeps organization quota when %s is non-zero", (_field, organization, expectedTotal) => {
    const data = {
      quotas: {
        organization: {
          ...organization,
          unit: "credits",
          resetAt,
        },
      },
    };

    expect(parseQuotaData("qoder", data)).toEqual([{
      name: "Organization",
      used: organization.used,
      total: expectedTotal,
      unit: "credits",
      resetAt,
    }]);
  });

  it("infers a finite total from meaningful zero-total usage", () => {
    const [organization] = parseQuotaData("qoder", {
      quotas: {
        organization: {
          total: 0,
          used: 3804,
          remaining: 6196,
          unit: "credits",
          resetAt,
        },
      },
    });

    expect(organization.total).toBe(10000);
    expect(getRemainingPercentage(organization)).toBe(62);
  });

  it("hides the all-zero organization placeholder", () => {
    const quotas = parseQuotaData("qoder", {
      quotas: {
        user: { total: 3000, used: 0, remaining: 3000, unit: "credits" },
        organization: { total: 0, used: 0, remaining: 0, unit: "credits" },
      },
    });

    expect(quotas.map((quota) => quota.name)).toEqual(["Personal"]);
  });

  it("keeps personal quota normalization unchanged", () => {
    expect(parseQuotaData("qoder", {
      quotas: {
        user: {
          total: 3000,
          used: 1200,
          remaining: 1800,
          unit: "credits",
          resetAt,
        },
      },
    })).toEqual([{
      name: "Personal",
      used: 1200,
      total: 3000,
      unit: "credits",
      resetAt,
    }]);
  });
});
