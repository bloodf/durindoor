import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const specPath = fileURLToPath(new URL("../e2e/storybook.spec.js", import.meta.url));
const spec = readFileSync(specPath, "utf8");

const manifestPath = fileURLToPath(new URL("../e2e/storybook-surfaces.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

/** Chart sources whose axis-tick contrast durin-ds-contrast.test.js composites. */
const guardedChartSources = [
  "usage/components/UsageChart.js",
  "token-saver/components/TokenSaverOverview.js",
  "pxpipe/PxpipeClient.js",
  "console-log/ConsoleLogPage.jsx",
  "timeline/TimelinePage.jsx",
  "token-saver/TokenSaverStatsPage.jsx",
  "headroom/HeadroomPage.jsx",
];

/** The story ids the evidence sweep will honour the chart contract for. */
function allowedChartStories() {
  const block = spec.match(/const CHART_AAA_STORIES = \[([\s\S]*?)\];/)?.[1];
  if (!block) throw new Error("CHART_AAA_STORIES is missing from the evidence spec");
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

// axe cannot measure two surfaces this dashboard owns and reports them
// `incomplete` rather than failing them: SVG text, and Monaco's transparent
// input proxy. The sweep exempts those, so the exemption itself needs a guard:
// it must stay narrow, stay tied to the sources that carry a real proof, and
// never swallow a rule that axe actually decided.
describe("evidence sweep unmeasurable contract", () => {
  it("exempts only the story ids whose charts carry a contrast proof", () => {
    const allowed = new Set(allowedChartStories());
    const guarded = new Set();
    for (const row of manifest.rows) {
      if (!guardedChartSources.some((source) => row.sourcePath.endsWith(source))) continue;
      for (const scenario of row.storyScenarios ?? []) guarded.add(scenario.storyId);
    }
    expect(guarded.size).toBeGreaterThan(0);
    const unproved = [...allowed].filter((storyId) => !guarded.has(storyId));
    const unlisted = [...guarded].filter((storyId) => !allowed.has(storyId));
    expect(unproved, `Exempted without a chart contrast proof:\n${unproved.join("\n")}`).toEqual([]);
    expect(unlisted, `Guarded chart story missing from the exemption:\n${unlisted.join("\n")}`).toEqual([]);
  });

  it("keeps Monaco's input proxy checked while it is visible for composition", () => {
    // `.ime-input` is the state where the proxy carries real colors, which is
    // exactly when a contrast failure would reach someone composing CJK text.
    expect(spec).toContain('textarea.inputarea:not(.ime-input)');
    const branch = spec.match(/textarea\.inputarea:not\(\.ime-input\)"\)\) \{([\s\S]*?)\n {6}\}/)?.[1] ?? "";
    expect(branch).toContain("zIndex");
    expect(branch).toContain("rgba(0, 0, 0, 0)");
  });

  it("never exempts a rule axe actually decided", () => {
    const audit = spec.match(/const audit = \(entries\) => entries\.flatMap\(\(entry\) => \{([\s\S]*?)\n {4}\}\);/)?.[1];
    expect(audit, "the audit helper is missing from the evidence spec").toBeTruthy();
    // Only the two contrast rules may be filtered, and only their incomplete
    // lists are passed through it; violations are summarised untouched.
    expect(audit).toContain('entry.id !== "color-contrast" && entry.id !== "color-contrast-enhanced"');
    expect(spec).toContain("audit(standards.incomplete)");
    expect(spec).toContain("audit(enhanced.incomplete)");
    expect(spec).not.toContain("audit(standards.violations");
    expect(spec).not.toContain("audit(enhanced.violations");
  });

  it("records every exemption in the saved evidence", () => {
    expect(spec).toContain("unmeasurable.push({ storyId, target: node.target, rule: entry.id, reason });");
    expect(spec).toContain("unmeasurable: a11y.unmeasurable ?? []");
  });
});
