// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { auditIncomplete, exemptionFor, resolveNode } from "../e2e/unmeasurable.mjs";

const CHARTED = "durin-ds-pages-timeline--default";
const UNCHARTED = "durin-ds-actions-button--primary";
const chartStories = [CHARTED];

/** Stand in for getComputedStyle with only the fields the policy reads. */
const styleOf = (overrides = {}) => () => ({ zIndex: "-10", color: "rgba(0, 0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)", ...overrides });

function chartTick() {
  document.body.innerHTML = `<g class="recharts-cartesian-axis-tick"><text><tspan id="tick">12:00</tspan></text></g>`;
  return document.getElementById("tick");
}

function monacoProxy(className = "inputarea") {
  document.body.innerHTML = `<div class="monaco-editor"><textarea id="proxy" class="${className}"></textarea></div>`;
  return document.getElementById("proxy");
}

const node = (id) => ({ target: [`#${id}`], html: `<${id}>` });

describe("unmeasurable node policy", () => {
  it("clears a chart tick only for a story whose contrast is proved", () => {
    const tick = chartTick();
    expect(exemptionFor(tick, CHARTED, chartStories, styleOf())).toBe("chart-axis-aaa-v1");
    expect(exemptionFor(tick, UNCHARTED, chartStories, styleOf())).toBeNull();
  });

  it("clears Monaco's proxy only while it is genuinely invisible", () => {
    expect(exemptionFor(monacoProxy(), CHARTED, chartStories, styleOf())).toBe("monaco-input-proxy");
    // Visible during composition: a real contrast failure would reach the
    // person typing, so it must stay checked.
    expect(exemptionFor(monacoProxy("inputarea ime-input"), CHARTED, chartStories, styleOf())).toBeNull();
    expect(exemptionFor(monacoProxy(), CHARTED, chartStories, styleOf({ zIndex: "5" }))).toBeNull();
    expect(exemptionFor(monacoProxy(), CHARTED, chartStories, styleOf({ color: "rgb(0, 0, 0)" }))).toBeNull();
  });

  it("leaves ordinary text alone", () => {
    document.body.innerHTML = `<p id="copy">Requests over time</p>`;
    expect(exemptionFor(document.getElementById("copy"), CHARTED, chartStories, styleOf())).toBeNull();
  });

  it("drops a cleared node and records why, keeping the rest of its entry", () => {
    document.body.innerHTML = `
      <g class="recharts-cartesian-axis-tick"><text><tspan id="tick">12:00</tspan></text></g>
      <p id="copy">Requests over time</p>`;
    const { entries, unmeasurable } = auditIncomplete(
      [{ id: "color-contrast", nodes: [node("tick"), node("copy")] }],
      { storyId: CHARTED, chartStories, resolve: (n) => resolveNode(n, document), computeStyle: styleOf() },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].nodes.map((entry) => entry.target[0])).toEqual(["#copy"]);
    expect(unmeasurable).toEqual([{ storyId: CHARTED, target: ["#tick"], rule: "color-contrast", reason: "chart-axis-aaa-v1" }]);
  });

  it("removes an entry only once every node is cleared", () => {
    chartTick();
    const { entries, unmeasurable } = auditIncomplete(
      [{ id: "color-contrast-enhanced", nodes: [node("tick")] }],
      { storyId: CHARTED, chartStories, resolve: (n) => resolveNode(n, document), computeStyle: styleOf() },
    );
    expect(entries).toEqual([]);
    expect(unmeasurable).toHaveLength(1);
  });

  it("never touches a rule axe actually decided", () => {
    chartTick();
    const decided = [{ id: "aria-valid-attr-value", nodes: [node("tick")] }];
    const { entries, unmeasurable } = auditIncomplete(decided, {
      storyId: CHARTED, chartStories, resolve: (n) => resolveNode(n, document), computeStyle: styleOf(),
    });
    expect(entries).toEqual(decided);
    expect(unmeasurable).toEqual([]);
  });

  it("keeps a node whose target crosses a frame or shadow boundary", () => {
    chartTick();
    const crossing = { target: ["iframe", "#tick"] };
    expect(resolveNode(crossing, document)).toBeNull();
    const { entries } = auditIncomplete([{ id: "color-contrast", nodes: [crossing] }], {
      storyId: CHARTED, chartStories, resolve: (n) => resolveNode(n, document), computeStyle: styleOf(),
    });
    expect(entries[0].nodes).toEqual([crossing]);
  });

  it("exempts exactly the story ids whose charts carry a proof", () => {
    const e2e = join(dirname(fileURLToPath(import.meta.url)), "..", "e2e");
    const spec = readFileSync(join(e2e, "storybook.spec.js"), "utf8");
    const allowed = new Set([...(spec.match(/const CHART_AAA_STORIES = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    const manifest = JSON.parse(readFileSync(join(e2e, "storybook-surfaces.json"), "utf8"));
    const guardedSources = ["usage/components/UsageChart.js", "token-saver/components/TokenSaverOverview.js", "pxpipe/PxpipeClient.js", "console-log/ConsoleLogPage.jsx", "timeline/TimelinePage.jsx", "token-saver/TokenSaverStatsPage.jsx", "headroom/HeadroomPage.jsx"];
    const guarded = new Set();
    for (const row of manifest.rows) {
      if (!guardedSources.some((source) => row.sourcePath.endsWith(source))) continue;
      for (const scenario of row.storyScenarios ?? []) guarded.add(scenario.storyId);
    }
    expect(guarded.size).toBeGreaterThan(0);
    expect([...allowed].filter((id) => !guarded.has(id)), "exempted without a chart contrast proof").toEqual([]);
    expect([...guarded].filter((id) => !allowed.has(id)), "guarded chart story missing from the exemption").toEqual([]);
  });
});
