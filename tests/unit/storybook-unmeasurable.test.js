// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { auditIncomplete, contrastRatio, exemptionFor, resolveNode, solidRgb } from "../e2e/unmeasurable.mjs";

const CHARTED = "durin-ds-pages-timeline--default";
const CONSOLE_CHART = "durin-ds-pages-console-log--log";
const UNCHARTED = "durin-ds-actions-button--primary";
const chartStories = [CHARTED];

/** Stand in for getComputedStyle with only the fields the policy reads. */
const styleOf = (overrides = {}) => () => ({ zIndex: "-10", color: "rgba(0, 0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)", ...overrides });

function chartTick() {
  document.body.innerHTML = `<div id="chart-outer"><div id="chart-surface"><svg>
    <defs><linearGradient id="area-fill">
      <stop id="start" offset="0%"/><stop id="end" offset="100%"/>
    </linearGradient></defs>
    <path id="area" d="M0 0L10 10Z"/>
    <g class="recharts-cartesian-axis-tick"><text><tspan id="tick">12:00</tspan></text></g>
  </svg></div></div>`;
  return document.getElementById("tick");
}

/** Live computed paint with a real SVG gradient, surface and inherited tokens. */
const chartStyle = (overrides = {}) => (element) => ({
  color: "rgb(237, 230, 216)", backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none", visibility: "visible", display: "block", opacity: "1",
  filter: "none", mixBlendMode: "normal", fill: "none", fillOpacity: "1", stroke: "none",
  markerStart: "none", markerMid: "none", markerEnd: "none",
  strokeWidth: "2px", strokeLinecap: "butt", strokeLinejoin: "miter", strokeMiterlimit: "4",
  vectorEffect: "none", transform: "none", perspective: "none",
  maskImage: "none", webkitMaskImage: "none", textShadow: "none", textDecorationLine: "none",
  getPropertyValue: (name) => ({
    "--dd-text-muted": "#ede6d8", "--dd-text-subtle": "#ede6d8",
    "--dd-surface": "#22201c", "--dd-accent": "#10e882", "--dd-info": "#60a5fa",
  })[name] ?? "",
  ...(element.id === "chart-surface" ? { backgroundColor: "rgb(34, 32, 28)" } : {}),
  ...(element.matches("text, tspan") ? { fill: "rgb(237, 230, 216)" } : {}),
  ...(element.id === "area" ? { fill: "url(#area-fill)" } : {}),
  ...(element.matches("stop") ? { stopColor: "rgb(16, 232, 130)", stopOpacity: element.id === "start" ? "0.14" : "0" } : {}),
  ...overrides[element.id],
});

/** happy-dom has no SVG layout: supply vector bounds at this policy boundary. */
function strokeBehindTick(tick, tag) {
  const paint = document.createElementNS("http://www.w3.org/2000/svg", tag);
  paint.id = "stroke-paint";
  paint.setAttribute("fill", "none");
  if (tag === "path") paint.setAttribute("d", "M12 14L28 14");
  else {
    for (const [name, value] of Object.entries({ x1: 12, y1: 14, x2: 28, y2: 14 })) paint.setAttribute(name, value);
  }
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
  tick.getBoundingClientRect = () => rect(10, 10, 30, 22);
  paint.getBoundingClientRect = () => rect(12, 14, 28, 14);
  paint.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1 });
  tick.closest("svg").insertBefore(paint, tick.closest(".recharts-cartesian-axis-tick"));
  return paint;
}

function otherTextBehindTick(tick, tag) {
  const paint = document.createElementNS("http://www.w3.org/2000/svg", tag);
  paint.id = "other-text";
  paint.textContent = "overlay";
  tick.getBoundingClientRect = () => ({ left: 10, right: 30, top: 10, bottom: 22 });
  paint.getBoundingClientRect = () => ({ left: 12, right: 28, top: 12, bottom: 20 });
  if (tag === "tspan") tick.before(paint);
  else tick.closest("svg").insertBefore(paint, tick.closest(".recharts-cartesian-axis-tick"));
  return paint;
}

function monacoProxy(className = "inputarea") {
  document.body.innerHTML = `<div class="monaco-editor"><textarea id="proxy" class="${className}"></textarea></div>`;
  return document.getElementById("proxy");
}

const node = (id) => ({ target: [`#${id}`], html: `<${id}>` });

/** Spread a [element, style] pair into exemptionFor's argument order. */
const withStyle = ([element, style]) => [element, CHARTED, chartStories, style];

describe("unmeasurable node policy", () => {
  it("clears a listed chart only while its live paint matches the composite proof", () => {
    const tick = chartTick();
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBe("chart-axis-aaa-v1");
    expect(exemptionFor(tick, UNCHARTED, chartStories, chartStyle())).toBeNull();
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle({ tick: { fill: "rgb(120, 116, 108)" } }))).toBeNull();
  });

  it("recognises a real SVG tick-label without requiring the outer tick class", () => {
    const tick = chartTick();
    tick.parentElement.classList.add("recharts-cartesian-axis-tick-label");
    tick.parentElement.parentElement.removeAttribute("class");
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBe("chart-axis-aaa-v1");
  });

  it("accepts the qualified INFO gradient only for its source-proved chart", () => {
    const tick = chartTick();
    const infoStyle = chartStyle({
      start: { stopColor: "rgb(96, 165, 250)" },
      end: { stopColor: "rgb(96, 165, 250)" },
    });
    const qualified = [...chartStories, CONSOLE_CHART];
    expect(exemptionFor(tick, CONSOLE_CHART, qualified, infoStyle)).toBe("chart-axis-aaa-v1");
    expect(exemptionFor(tick, CHARTED, qualified, infoStyle)).toBeNull();
    expect(exemptionFor(tick, CONSOLE_CHART, qualified, chartStyle())).toBeNull();
    expect(exemptionFor(tick, CONSOLE_CHART, [], infoStyle)).toBeNull();
  });

  it.each(["line", "path"])("retains an identical-glyph %s stroke even when its fill is none", (tag) => {
    const tick = chartTick();
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBe("chart-axis-aaa-v1");
    strokeBehindTick(tick, tag);
    const style = chartStyle({ "stroke-paint": { stroke: "rgb(237, 230, 216)", fill: "none" } });
    expect(exemptionFor(tick, CHARTED, chartStories, style)).toBeNull();
  });

  it.each(["line", "path"])("excludes a %s stroke only after proving expanded bounds miss the glyph", (tag) => {
    const tick = chartTick();
    const paint = strokeBehindTick(tick, tag);
    paint.getBoundingClientRect = () => ({ left: 12, right: 28, top: 0, bottom: 0 });
    const style = chartStyle({ "stroke-paint": { stroke: "rgb(237, 230, 216)", fill: "none" } });
    expect(exemptionFor(tick, CHARTED, chartStories, style)).toBe("chart-axis-aaa-v1");
    // The centerline is still outside; only the wider stroke reaches the tick.
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle({
      "stroke-paint": { stroke: "rgb(237, 230, 216)", fill: "none", strokeWidth: "24px" },
    }))).toBeNull();
    paint.getScreenCTM = () => ({ a: 10, b: 0, c: 0, d: 10 });
    expect(exemptionFor(tick, CHARTED, chartStories, style)).toBeNull();
    paint.getScreenCTM = () => null;
    expect(exemptionFor(tick, CHARTED, chartStories, style)).toBeNull();
  });

  it("does not turn a line's irrelevant fill into a stroke exemption", () => {
    const tick = chartTick();
    const paint = strokeBehindTick(tick, "line");
    const style = chartStyle({
      "stroke-paint": { stroke: "rgb(237, 230, 216)", fill: "rgb(237, 230, 216)" },
    });
    expect(exemptionFor(tick, CHARTED, chartStories, style)).toBeNull();
    paint.getBoundingClientRect = () => ({ left: 12, right: 28, top: 0, bottom: 0 });
    expect(exemptionFor(tick, CHARTED, chartStories, style)).toBe("chart-axis-aaa-v1");
  });

  it("retains unknown stroke paint impact and marker paint rather than assuming a surface", () => {
    const tick = chartTick();
    const paint = strokeBehindTick(tick, "path");
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle({
      "stroke-paint": { stroke: "url(#unproved)", fill: "none" },
    }))).toBeNull();
    paint.getBoundingClientRect = () => ({ left: 12, right: 28, top: 0, bottom: 0 });
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle({
      "stroke-paint": { stroke: "rgb(237, 230, 216)", fill: "none", markerEnd: "url(#unproved)" },
    }))).toBeNull();
  });

  it.each([
    ["glyph CSS mask", { tick: { maskImage: "url(#fade)" } }],
    ["prefixed mask", { tick: { webkitMaskImage: "url(#fade)" } }],
    ["masked ancestor above the opaque surface", { "chart-outer": { maskImage: "url(#fade)" } }],
    ["unresolved mask state", { tick: { maskImage: "" } }],
  ])("retains %s even when opacity and fill opacity remain one", (_name, overrides) => {
    const tick = chartTick();
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBe("chart-axis-aaa-v1");
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle(overrides))).toBeNull();
  });

  it.each(["glyph", "ancestor"])("refuses a fading SVG mask on the %s without trusting unchanged opacity", (where) => {
    const tick = chartTick();
    tick.closest("svg").querySelector("defs").insertAdjacentHTML("beforeend",
      `<mask id="fade"><rect width="100%" height="100%" fill="white" opacity="0.25"/></mask>`);
    const masked = where === "glyph" ? tick : tick.parentElement.parentElement;
    masked.setAttribute("mask", "url(#fade)");
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBeNull();
    masked.removeAttribute("mask");
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBe("chart-axis-aaa-v1");
  });

  it.each(["text", "tspan"])("requires proved nonintersection for other SVG %s paint", (tag) => {
    const tick = chartTick();
    const paint = otherTextBehindTick(tick, tag);
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBeNull();
    paint.getBoundingClientRect = () => ({ left: 40, right: 50, top: 10, bottom: 22 });
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBe("chart-axis-aaa-v1");
    paint.getBoundingClientRect = () => ({ left: NaN, right: NaN, top: NaN, bottom: NaN });
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBeNull();
  });

  it("does not ignore unproved textPath paint inside an otherwise empty text wrapper", () => {
    const tick = chartTick();
    const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const paint = document.createElementNS("http://www.w3.org/2000/svg", "textPath");
    paint.setAttribute("href", "#area");
    paint.textContent = "overlay";
    wrapper.append(paint);
    tick.closest("svg").append(wrapper);
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBeNull();
  });

  it("bounds other text stroke ink as well as its separated fill rectangle", () => {
    const tick = chartTick();
    const paint = otherTextBehindTick(tick, "text");
    paint.getBoundingClientRect = () => ({ left: 40, right: 50, top: 10, bottom: 22 });
    paint.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1 });
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBe("chart-axis-aaa-v1");
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle({
      "other-text": { stroke: "rgb(237, 230, 216)", strokeWidth: "24px" },
    }))).toBeNull();
  });

  it("does not count glyph wrappers twice or silently accept differing descendant paint", () => {
    const tick = chartTick();
    const wrapper = tick.parentElement;
    expect(exemptionFor(wrapper, CHARTED, chartStories, chartStyle())).toBe("chart-axis-aaa-v1");
    tick.innerHTML = `<tspan id="nested">12:00</tspan>`;
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBe("chart-axis-aaa-v1");
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle({
      nested: { fill: "rgb(120, 116, 108)" },
    }))).toBeNull();
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle({
      nested: { maskImage: "url(#fade)" },
    }))).toBeNull();
  });

  it("retains an ancestor's additional direct text run instead of skipping its union bounds", () => {
    const tick = chartTick();
    tick.parentElement.append(document.createTextNode("other paint"));
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBeNull();
  });

  it("refuses a non-scaling stroke when external scale cancels the viewBox CTM scale", () => {
    const tick = chartTick();
    const paint = strokeBehindTick(tick, "line");
    const svg = tick.closest("svg");
    svg.id = "scaled-svg";
    svg.setAttribute("viewBox", "0 0 1000 1000");
    paint.getBoundingClientRect = () => ({ left: 12, right: 28, top: 7, bottom: 7 });
    // External 10x CSS scale and 0.1x viewBox scale leave total CTM at 1.
    paint.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1 });
    const regular = chartStyle({
      "scaled-svg": { transform: "matrix(10, 0, 0, 10, 0, 0)" },
      "stroke-paint": { stroke: "rgb(237, 230, 216)" },
    });
    expect(exemptionFor(tick, CHARTED, chartStories, regular)).toBe("chart-axis-aaa-v1");
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle({
      "scaled-svg": { transform: "matrix(10, 0, 0, 10, 0, 0)" },
      "stroke-paint": { stroke: "rgb(237, 230, 216)", vectorEffect: "non-scaling-stroke" },
    }))).toBeNull();
  });

  it.each([
    ["faded glyph", { tick: { opacity: "0.4" } }],
    ["translucent glyph fill", { tick: { fillOpacity: "0.4" } }],
    ["unresolved glyph", { tick: { fill: "url(#missing)" } }],
    ["faded ancestor above the opaque surface", { "chart-outer": { opacity: "0.4" } }],
    ["image background", { "chart-surface": { backgroundImage: "url(image.png)" } }],
    ["no opaque backdrop", { "chart-surface": { backgroundColor: "rgba(0, 0, 0, 0)" } }],
    ["different opaque backdrop", { "chart-surface": { backgroundColor: "rgb(255, 255, 255)" } }],
    ["unresolved area", { area: { fill: "url(#missing)" } }],
    ["foreign gradient", { area: { fill: "url(https://example.invalid/chart.svg#area-fill)" } }],
    ["faded area", { area: { opacity: "0.4" } }],
    ["unproved stop color", { start: { stopColor: "rgb(255, 255, 255)" } }],
    ["stop alpha beyond the source bound", { start: { stopOpacity: "0.140001" } }],
    ["unresolved stop alpha", { start: { stopOpacity: "unknown" } }],
    ["empty stop alpha", { start: { stopOpacity: "" } }],
    ["empty area alpha", { area: { fillOpacity: "" } }],
    ["filtered paint", { area: { filter: "blur(2px)" } }],
  ])("keeps a listed axis incomplete with %s", (_name, overrides) => {
    expect(exemptionFor(chartTick(), CHARTED, chartStories, chartStyle(overrides))).toBeNull();
  });

  it.each([6.99, 7.01])("checks the live AAA ratio at %s rather than trusting token names", (ratio) => {
    const tick = chartTick();
    const channel = 255 * (1.055 * ((1.05 / ratio - 0.05) ** (1 / 2.4)) - 0.055);
    const background = `rgb(${channel}, ${channel}, ${channel})`;
    const tokens = (name) => ({
      "--dd-text-muted": "#ffffff", "--dd-surface": background, "--dd-accent": "#10e882",
    })[name] ?? "";
    const style = chartStyle({
      tick: { fill: "rgb(255, 255, 255)", getPropertyValue: tokens },
      "chart-surface": { backgroundColor: background },
      start: { stopOpacity: "0" }, end: { stopOpacity: "0" },
    });
    const reason = exemptionFor(tick, CHARTED, chartStories, style);
    if (ratio < 7) expect(reason).toBeNull();
    else expect(reason).toBe("chart-axis-aaa-v1");
  });

  it("refuses overlapping areas whose possible composite falls below AAA", () => {
    const tick = chartTick();
    const area = document.getElementById("area");
    // Each individual 0.14 tint passes, but three overlapping tints do not.
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBe("chart-axis-aaa-v1");
    for (let i = 0; i < 2; i += 1) {
      const copy = area.cloneNode(true);
      copy.removeAttribute("id");
      copy.setAttribute("data-area", "");
      area.after(copy);
    }
    const style = (element) => ({
      ...chartStyle()(element),
      ...(element.hasAttribute("data-area") ? { fill: "url(#area-fill)" } : {}),
    });
    expect(exemptionFor(tick, CHARTED, chartStories, style)).toBeNull();
  });

  it.each(["image", "foreignObject", "use"])("refuses an unproved SVG %s paint", (tag) => {
    const tick = chartTick();
    tick.closest("svg").append(document.createElementNS("http://www.w3.org/2000/svg", tag));
    expect(exemptionFor(tick, CHARTED, chartStories, chartStyle())).toBeNull();
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
    chartTick();
    document.body.insertAdjacentHTML("beforeend", `<p id="copy">Requests over time</p>`);
    const { entries, unmeasurable } = auditIncomplete(
      [{ id: "color-contrast", nodes: [node("tick"), node("copy")] }],
      { storyId: CHARTED, chartStories, resolve: (n) => resolveNode(n, document), computeStyle: chartStyle() },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].nodes.map((entry) => entry.target[0])).toEqual(["#copy"]);
    expect(unmeasurable).toEqual([{ storyId: CHARTED, target: ["#tick"], rule: "color-contrast", reason: "chart-axis-aaa-v1" }]);
  });

  it("removes an entry only once every node is cleared", () => {
    chartTick();
    const { entries, unmeasurable } = auditIncomplete(
      [{ id: "color-contrast-enhanced", nodes: [node("tick")] }],
      { storyId: CHARTED, chartStories, resolve: (n) => resolveNode(n, document), computeStyle: chartStyle() },
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
});
