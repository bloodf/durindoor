// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { auditIncomplete, contrastRatio, exemptionFor, resolveNode, solidRgb } from "../e2e/unmeasurable.mjs";

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

/** Spread a [element, style] pair into exemptionFor's argument order. */
const withStyle = ([element, style]) => [element, CHARTED, chartStories, style];

describe("unmeasurable node policy", () => {
  it("clears a chart tick only for a story whose contrast is proved", () => {
    const tick = chartTick();
    expect(exemptionFor(tick, CHARTED, chartStories, styleOf())).toBe("chart-axis-aaa-v1");
    expect(exemptionFor(tick, UNCHARTED, chartStories, styleOf())).toBeNull();
  });

  it("recognises the tick-label shape axe actually reports", () => {
    // Recharts nests the text in `-tick-label`; a policy matching only the
    // outer `-tick` group silently exempted nothing on the real charts.
    document.body.innerHTML = `<g><text class="recharts-cartesian-axis-tick-label"><tspan id="label">12:00</tspan></text></g>`;
    expect(exemptionFor(document.getElementById("label"), CHARTED, chartStories, styleOf())).toBe("chart-axis-aaa-v1");
  });

  it("clears the ime-text-area proxy Monaco actually renders", () => {
    // The shipped editor names the proxy `ime-text-area`, not `inputarea`, so
    // a policy matching only the latter exempted nothing and left two stories
    // failing for a node axe never judged.
    expect(exemptionFor(monacoProxy("ime-text-area"), CHARTED, chartStories, styleOf())).toBe("monaco-input-proxy");
    expect(exemptionFor(monacoProxy("ime-text-area ime-input"), CHARTED, chartStories, styleOf())).toBeNull();
    // A renamed class must never be enough on its own; the paint still decides.
    expect(exemptionFor(monacoProxy("ime-text-area"), CHARTED, chartStories, styleOf({ color: "rgb(0, 0, 0)" }))).toBeNull();
  });

  it("clears Monaco's proxy only while it is genuinely invisible", () => {
    expect(exemptionFor(monacoProxy(), CHARTED, chartStories, styleOf())).toBe("monaco-input-proxy");
    // Visible during composition: a real contrast failure would reach the
    // person typing, so it must stay checked.
    expect(exemptionFor(monacoProxy("inputarea ime-input"), CHARTED, chartStories, styleOf())).toBeNull();
    expect(exemptionFor(monacoProxy(), CHARTED, chartStories, styleOf({ zIndex: "5" }))).toBeNull();
    expect(exemptionFor(monacoProxy(), CHARTED, chartStories, styleOf({ color: "rgb(0, 0, 0)" }))).toBeNull();
  });

  // A DS button axe declined to judge, whose pair is fully computable here.
  const button = (overrides = {}) => {
    document.body.innerHTML = `<button id="btn" class="min-w-11">Format</button>`;
    return [document.getElementById("btn"), () => ({ color: "rgb(237, 230, 216)", backgroundColor: "rgb(34, 32, 28)", backgroundImage: "none", visibility: "visible", opacity: "1", fontSize: "13px", fontWeight: "500", ...overrides })];
  };

  it("clears ordinary text only when its own pair proves the threshold", () => {
    const [element, style] = button();
    expect(exemptionFor(element, CHARTED, chartStories, style)).toBe("measured-aaa 13.10:1");
  });

  it("keeps ordinary text that misses the threshold", () => {
    const [element, style] = button({ color: "rgb(120, 116, 108)" });
    expect(exemptionFor(element, CHARTED, chartStories, style)).toBeNull();
  });

  it("keeps text whose pair cannot be computed here", () => {
    // Translucent, image-backed, hidden or transparent surfaces are exactly
    // the cases axe cannot resolve either, so they must keep failing.
    expect(exemptionFor(...withStyle(button({ backgroundColor: "rgba(34, 32, 28, 0.5)" })))).toBeNull();
    expect(exemptionFor(...withStyle(button({ backgroundImage: "linear-gradient(red, blue)" })))).toBeNull();
    expect(exemptionFor(...withStyle(button({ visibility: "hidden" })))).toBeNull();
    expect(exemptionFor(...withStyle(button({ opacity: "0.4" })))).toBeNull();
  });

  it("applies the large-text threshold only to genuinely large text", () => {
    const [element, style] = button({ color: "rgb(150, 145, 135)", fontSize: "24px" });
    expect(contrastRatio(solidRgb("rgb(150, 145, 135)"), solidRgb("rgb(34, 32, 28)"))).toBeGreaterThan(4.5);
    expect(exemptionFor(element, CHARTED, chartStories, style)).toMatch(/^measured-aaa /);
    const [small, smallStyle] = button({ color: "rgb(150, 145, 135)", fontSize: "13px" });
    expect(exemptionFor(small, CHARTED, chartStories, smallStyle)).toBeNull();
  });

  it("keeps text whose surface it cannot read", () => {
    // A bare paragraph inherits a transparent background, so the pair is not
    // computable here and the node must keep failing.
    document.body.innerHTML = `<p id="copy">Requests over time</p>`;
    const style = () => ({ color: "rgb(237, 230, 216)", backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none", visibility: "visible", opacity: "1", fontSize: "13px", fontWeight: "400" });
    expect(exemptionFor(document.getElementById("copy"), CHARTED, chartStories, style)).toBeNull();
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
