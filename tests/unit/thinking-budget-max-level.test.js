// Port of upstream 9router #4228: the reverse map from budget_tokens to a
// discrete effort level had no threshold above "high", so every budget over
// 28672 collapsed to "xhigh" and "max" was unreachable. Claude Code sends its
// thinking budget as budget_tokens, so its largest setting could never ask for
// the top tier.
import { describe, expect, it } from "vitest";
import { budgetToLevel, effortToBudget, LEVEL_TO_BUDGET } from "open-sse/translator/concerns/thinking.js";

describe("budgetToLevel", () => {
  it("reaches max for budgets near the max tier", () => {
    expect(budgetToLevel(LEVEL_TO_BUDGET.max)).toBe("max");
    expect(budgetToLevel(98304)).toBe("max");
  });

  it("splits xhigh and max at their midpoint", () => {
    // xhigh is 32768 and max is 128000, so the boundary is 80384.
    expect(budgetToLevel(80384)).toBe("xhigh");
    expect(budgetToLevel(80385)).toBe("max");
  });

  it("leaves the lower tiers where they were", () => {
    expect(budgetToLevel(0)).toBeNull();
    expect(budgetToLevel(512)).toBe("minimal");
    expect(budgetToLevel(1024)).toBe("low");
    expect(budgetToLevel(8192)).toBe("medium");
    expect(budgetToLevel(24576)).toBe("high");
    expect(budgetToLevel(31999)).toBe("xhigh");
  });

  it("round-trips every level's own budget back to that level", () => {
    for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
      expect(budgetToLevel(effortToBudget(level))).toBe(level);
    }
  });
});
