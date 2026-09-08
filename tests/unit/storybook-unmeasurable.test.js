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
    // An image-backed, hidden or faded surface is exactly what axe cannot
    // resolve either, so those must keep failing. A translucent fill is
    // different: it composites onto the surface behind it, so it is handled
    // by the tint test below rather than refused here.
    expect(exemptionFor(...withStyle(button({ backgroundImage: "linear-gradient(red, blue)" })))).toBeNull();
    expect(exemptionFor(...withStyle(button({ visibility: "hidden" })))).toBeNull();
    expect(exemptionFor(...withStyle(button({ opacity: "0.4" })))).toBeNull();
  });

  it("composites a translucent tint onto the surface behind it", () => {
    // A `bg-dd-accent-soft` chip is rgba(16, 232, 130, 0.14) over the page
    // surface. axe gives up on the pair, but it is ordinary alpha
    // compositing over a known backdrop, so the real ratio is exact. This
    // is the case that kept 26 stories red for a verdict axe never reached.
    document.body.innerHTML = `<div id="page"><span id="chip">Custom</span></div>`;
    const style = (element) => element.id === "page"
      ? { color: "rgb(0, 0, 0)", backgroundColor: "rgb(34, 32, 28)", backgroundImage: "none", visibility: "visible", opacity: "1", fontSize: "13px", fontWeight: "400" }
      : { color: "rgb(237, 230, 216)", backgroundColor: "rgba(16, 232, 130, 0.14)", backgroundImage: "none", visibility: "visible", opacity: "1", fontSize: "13px", fontWeight: "400" };
    // #EDE6D8 over the composited rgb(30.9, 60.0, 42.3) is 9.72:1 - clears AAA.
    expect(exemptionFor(document.getElementById("chip"), CHARTED, chartStories, style)).toBe("measured-aaa 9.72:1");
  });

  it("still fails a tint whose composited pair misses the threshold", () => {
    // Compositing must not become a way to pass; a genuinely low-contrast
    // chip has to stay red once the real backdrop is worked out.
    document.body.innerHTML = `<div id="page"><span id="chip">Custom</span></div>`;
    const style = (element) => element.id === "page"
      ? { color: "rgb(0, 0, 0)", backgroundColor: "rgb(34, 32, 28)", backgroundImage: "none", visibility: "visible", opacity: "1", fontSize: "13px", fontWeight: "400" }
      : { color: "rgb(120, 116, 108)", backgroundColor: "rgba(16, 232, 130, 0.14)", backgroundImage: "none", visibility: "visible", opacity: "1", fontSize: "13px", fontWeight: "400" };
    expect(exemptionFor(document.getElementById("chip"), CHARTED, chartStories, style)).toBeNull();
  });

  it("refuses a tint that has no opaque surface to composite onto", () => {
    // Without a backdrop the stack is unresolvable, so it must stay failing
    // rather than compositing onto an assumed colour.
    document.body.innerHTML = `<div id="page"><span id="chip">Custom</span></div>`;
    const style = () => ({ color: "rgb(237, 230, 216)", backgroundColor: "rgba(16, 232, 130, 0.14)", backgroundImage: "none", visibility: "visible", opacity: "1", fontSize: "13px", fontWeight: "400" });
    expect(exemptionFor(document.getElementById("chip"), CHARTED, chartStories, style)).toBeNull();
  });

  it("applies the large-text threshold only to genuinely large text", () => {
    const [element, style] = button({ color: "rgb(150, 145, 135)", fontSize: "24px" });
    expect(contrastRatio(solidRgb("rgb(150, 145, 135)"), solidRgb("rgb(34, 32, 28)"))).toBeGreaterThan(4.5);
    expect(exemptionFor(element, CHARTED, chartStories, style)).toMatch(/^measured-aaa /);
    const [small, smallStyle] = button({ color: "rgb(150, 145, 135)", fontSize: "13px" });
    expect(exemptionFor(small, CHARTED, chartStories, smallStyle)).toBeNull();
  });

  it("reads the surface an ancestor paints when the text has none", () => {
    // Most text sits on a parent's surface; axe declines exactly these, so the
    // walk is what makes 105 of the refused nodes measurable at all.
    document.body.innerHTML = `<div id="card"><p id="copy">Requests over time</p></div>`;
    const style = (element) => element.id === "card"
      ? { color: "rgb(0, 0, 0)", backgroundColor: "rgb(34, 32, 28)", backgroundImage: "none", visibility: "visible", opacity: "1", fontSize: "13px", fontWeight: "400" }
      : { color: "rgb(237, 230, 216)", backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none", visibility: "visible", opacity: "1", fontSize: "13px", fontWeight: "400" };
    expect(exemptionFor(document.getElementById("copy"), CHARTED, chartStories, style)).toBe("measured-aaa 13.10:1");
  });

  it("refuses a partly translucent ancestor rather than reading through it", () => {
    // `rgba(0, 0, 0, 0.5)` shares a prefix with the fully clear colour, so a
    // prefix test would silently treat a half-opaque layer as absent.
    document.body.innerHTML = `<div id="card"><p id="copy">Requests over time</p></div>`;
    const style = (element) => element.id === "card"
      ? { color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0.5)", backgroundImage: "none", visibility: "visible", opacity: "1", fontSize: "13px", fontWeight: "400" }
      : { color: "rgb(237, 230, 216)", backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none", visibility: "visible", opacity: "1", fontSize: "13px", fontWeight: "400" };
    expect(exemptionFor(document.getElementById("copy"), CHARTED, chartStories, style)).toBeNull();
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
