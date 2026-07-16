import { describe, it, expect } from "vitest";
import {
  getUpdaterPhaseLabel,
  getUpdaterProgressPercent,
  getUpdaterStartupBudgetMs,
  getUpdaterStatusUrl,
  hasExceededStartupBudget,
  isUpdaterFailure,
  isUpdaterSuccess,
} from "../../src/shared/utils/updaterStatus.js";

// Port of decolua/9router #2575 tests/unit/updater-status.test.js, plus
// lifecycle coverage for the bounded startup/poll budget (durindoor addition:
// upstream polls forever when the detached status endpoint never appears).
describe("updaterStatus helpers", () => {
  it("builds local status URL on the configured port", () => {
    expect(getUpdaterStatusUrl(20129)).toBe("http://127.0.0.1:20129/update/status");
    expect(getUpdaterStatusUrl()).toContain("127.0.0.1");
    expect(getUpdaterStatusUrl()).toContain("/update/status");
  });

  it("labels known phases", () => {
    expect(getUpdaterPhaseLabel("starting")).toMatch(/starting/i);
    expect(getUpdaterPhaseLabel("waitingForExit")).toMatch(/stopping/i);
    expect(getUpdaterPhaseLabel("installing", { attempt: 2, maxRetries: 3 })).toMatch(/2\/3/);
    expect(getUpdaterPhaseLabel("done")).toMatch(/complete|restart/i);
    expect(getUpdaterPhaseLabel("error")).toMatch(/failed/i);
  });

  it("maps phases to increasing progress", () => {
    const start = getUpdaterProgressPercent({ phase: "starting" });
    const wait = getUpdaterProgressPercent({ phase: "waitingForExit" });
    const install = getUpdaterProgressPercent({ phase: "installing", attempt: 1, maxRetries: 3 });
    const done = getUpdaterProgressPercent({ phase: "done", done: true, success: true });
    expect(start).toBeLessThan(wait);
    expect(wait).toBeLessThan(install);
    expect(install).toBeLessThan(done);
    expect(done).toBe(100);
  });

  it("detects success and failure terminal states", () => {
    expect(isUpdaterSuccess({ done: true, success: true })).toBe(true);
    expect(isUpdaterSuccess({ done: true, success: false })).toBe(false);
    expect(isUpdaterFailure({ phase: "error" })).toBe(true);
    expect(isUpdaterFailure({ done: true, success: false })).toBe(true);
    expect(isUpdaterFailure({ phase: "installing" })).toBe(false);
  });

  it("treats a never-appearing status endpoint as terminal once budget is exceeded", () => {
    const budgetMs = getUpdaterStartupBudgetMs();
    expect(budgetMs).toBeGreaterThan(60000);

    const startedAt = 1_000_000;
    // Endpoint unreachable while well inside budget: keep polling, no failure
    expect(hasExceededStartupBudget(startedAt, startedAt + 1000)).toBe(false);
    expect(hasExceededStartupBudget(startedAt, startedAt + budgetMs - 1)).toBe(false);
    // Same unreachable state past budget: panel must fail over to manual install
    expect(hasExceededStartupBudget(startedAt, startedAt + budgetMs + 1)).toBe(true);
    // Malformed inputs never trip the guard
    expect(hasExceededStartupBudget(null, startedAt + budgetMs + 1)).toBe(false);
  });

  it("success inside the budget stays terminal-success (no timeout flip)", () => {
    const startedAt = 1_000_000;
    const status = { phase: "done", done: true, success: true };
    expect(isUpdaterSuccess(status)).toBe(true);
    expect(isUpdaterFailure(status)).toBe(false);
    expect(hasExceededStartupBudget(startedAt, startedAt + 5000)).toBe(false);
  });

  it("updater-reported error inside the budget is terminal-failure", () => {
    const startedAt = 1_000_000;
    const status = { phase: "error", done: true, success: false, error: "npm exited 1" };
    expect(isUpdaterFailure(status)).toBe(true);
    expect(isUpdaterSuccess(status)).toBe(false);
    expect(hasExceededStartupBudget(startedAt, startedAt + 5000)).toBe(false);
  });
});
