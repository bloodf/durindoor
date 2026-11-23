import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import postcss from "postcss";

it("shows the desktop sidebar only at the desktop breakpoint", () => {
  const layout = readFileSync(new URL("../../src/shared/components/layouts/DashboardLayout.js", import.meta.url), "utf8");
  const css = postcss.parse(readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8"));
  expect(layout).toContain('className="dashboard-sidebar-desktop shrink-0"');
  const rules = [];
  css.walkRules(".dashboard-sidebar-desktop", (rule) => rules.push({ media: rule.parent.params, display: rule.nodes.find((node) => node.prop === "display")?.value }));
  expect(rules).toEqual([{ media: undefined, display: "none" }, { media: "(min-width: 1024px)", display: "flex" }]);
});
