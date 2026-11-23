import { describe, expect, it } from "vitest";
import { filterModelRows, toggleVisibleModels, runModelOperations } from "../../src/app/(dashboard)/dashboard/providers/[id]/modelSelection.js";

const rows = [
  { id: "alpha", key: "builtin:alpha", group: "active" },
  { id: "beta", key: "builtin:beta", group: "disabled" },
  { id: "gamma", key: "custom:gamma", group: "custom" },
];

describe("provider model selection", () => {
  it("filters and sorts while retaining selections hidden by another group", () => {
    const active = filterModelRows(rows, "a", "active", "contains", "");
    let selected = toggleVisibleModels([], active);
    const disabled = filterModelRows(rows, "be", "disabled", "startsWith", "");
    selected = toggleVisibleModels(selected, disabled);
    expect(selected).toEqual(["builtin:alpha", "builtin:beta"]);
    expect(toggleVisibleModels(selected, disabled)).toEqual(["builtin:alpha"]);
    expect(filterModelRows(rows, "a", "all", "notContains", "")).toEqual([]);
    expect(filterModelRows(rows, "", "all", "contains", "desc").map((row) => row.id)).toEqual(["gamma", "beta", "alpha"]);
  });
  it("continues after an operation fails and identifies the selection to retain", async () => {
    const result = await runModelOperations(rows, async (row) => { if (row.id === "beta") throw new Error("failed"); });
    expect(result).toEqual({ succeeded: ["builtin:alpha", "custom:gamma"], failed: ["beta"] });
  });
});
