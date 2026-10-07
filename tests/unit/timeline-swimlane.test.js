// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import TimelineSwimlane, {
  DEFAULT_CHART_WIDTH,
  LABEL_WIDTH,
  MAX_LANES,
  MIN_BAR_WIDTH,
  OTHER_LANE,
  UNSET_LANE,
  barGeometry,
  buildLanes,
  buildTicks,
} from "@/app/(dashboard)/dashboard/timeline/components/TimelineSwimlane.jsx";
import { upsertTraces } from "@/app/(dashboard)/dashboard/timeline/useWindowedTraces.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const WINDOW_START = Date.parse("2026-09-05T12:00:00.000Z");
const WINDOW_END = WINDOW_START + 15 * 60_000;
const PLOT_WIDTH = DEFAULT_CHART_WIDTH - LABEL_WIDTH;
const at = (minutes) => new Date(WINDOW_START + minutes * 60_000).toISOString();

function trace(id, overrides = {}) {
  return { id, started_at: at(1), status: "ok", provider: "codex", model: "gpt-5", connection_id: "conn-a", event_count: 3, total_ms: 1000, ...overrides };
}

describe("buildLanes", () => {
  it("creates one sorted lane per distinct laneBy value", () => {
    const traces = [
      trace("t1", { provider: "codex", connection_id: "conn-b" }),
      trace("t2", { provider: "anthropic", connection_id: "conn-a" }),
      trace("t3", { provider: "codex", connection_id: "conn-a" }),
      trace("t4", { provider: null, connection_id: null }),
    ];
    const byProvider = buildLanes(traces, "provider");
    expect(byProvider.lanes.filter((lane) => lane !== UNSET_LANE)).toEqual(["anthropic", "codex"]);
    expect(byProvider.lanes).toHaveLength(3);
    expect(traces.map(byProvider.laneFor)).toEqual(["codex", "anthropic", "codex", UNSET_LANE]);

    const byConnection = buildLanes(traces, "connection_id");
    expect(byConnection.lanes.filter((lane) => lane !== UNSET_LANE)).toEqual(["conn-a", "conn-b"]);
    expect(byConnection.laneFor(traces[3])).toBe(UNSET_LANE);
    expect(byConnection.laneFor(traces[0])).toBe("conn-b");
  });

  it("caps at MAX_LANES and routes the least busy values into a trailing 'other' lane", () => {
    const traces = [];
    for (let i = 0; i < 14; i += 1) {
      const provider = `p${String(i).padStart(2, "0")}`;
      // p00..p02 get one trace each; the eleven others get three.
      const count = i < 3 ? 1 : 3;
      for (let n = 0; n < count; n += 1) traces.push(trace(`${provider}-${n}`, { provider }));
    }
    const { lanes, laneFor } = buildLanes(traces, "provider");
    expect(lanes).toHaveLength(MAX_LANES);
    expect(lanes.at(-1)).toBe(OTHER_LANE);
    expect(lanes.slice(0, -1)).toEqual(["p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10", "p11", "p12", "p13"]);
    expect(laneFor(trace("x", { provider: "p00" }))).toBe(OTHER_LANE);
    expect(laneFor(trace("x", { provider: "p01" }))).toBe(OTHER_LANE);
    expect(laneFor(trace("x", { provider: "p02" }))).toBe(OTHER_LANE);
    expect(laneFor(trace("x", { provider: "p13" }))).toBe("p13");
  });

  it("keeps exactly MAX_LANES distinct values without an overflow lane", () => {
    const traces = Array.from({ length: MAX_LANES }, (_, i) => trace(`t${i}`, { provider: `p${String(i).padStart(2, "0")}` }));
    const { lanes } = buildLanes(traces, "provider");
    expect(lanes).toHaveLength(MAX_LANES);
    expect(lanes).not.toContain(OTHER_LANE);
  });
});

describe("barGeometry", () => {
  it("positions by started_at and scales width by total_ms", () => {
    const geometry = barGeometry(trace("t", { started_at: at(5), total_ms: 3 * 60_000 }), WINDOW_START, WINDOW_END, PLOT_WIDTH, WINDOW_END);
    expect(geometry.x).toBeCloseTo(PLOT_WIDTH / 3, 6);
    expect(geometry.width).toBeCloseTo(PLOT_WIDTH / 5, 6);
  });

  it("clamps very short traces to the minimum bar width", () => {
    for (const totalMs of [0, 1, 50]) {
      const geometry = barGeometry(trace("t", { total_ms: totalMs }), WINDOW_START, WINDOW_END, PLOT_WIDTH, WINDOW_END);
      expect(geometry.width).toBe(MIN_BAR_WIDTH);
    }
  });

  it("extends running traces to nowMs and clips bars to the window", () => {
    const running = barGeometry(trace("t", { started_at: at(10), total_ms: null }), WINDOW_START, WINDOW_END, PLOT_WIDTH, WINDOW_START + 12 * 60_000);
    expect(running.width).toBeCloseTo((2 / 15) * PLOT_WIDTH, 6);

    const overhang = barGeometry(trace("t", { started_at: at(14), total_ms: 10 * 60_000 }), WINDOW_START, WINDOW_END, PLOT_WIDTH, WINDOW_END);
    expect(overhang.x + overhang.width).toBeCloseTo(PLOT_WIDTH, 6);

    expect(barGeometry(trace("t", { started_at: at(-10), total_ms: 1000 }), WINDOW_START, WINDOW_END, PLOT_WIDTH, WINDOW_END)).toBeNull();
    expect(barGeometry(trace("t", { started_at: "not a date" }), WINDOW_START, WINDOW_END, PLOT_WIDTH, WINDOW_END)).toBeNull();
  });
});

describe("buildTicks", () => {
  it("picks a step that yields at most six labelled ticks inside the window", () => {
    const { step, ticks } = buildTicks(WINDOW_START, WINDOW_END);
    expect(step).toBe(5 * 60_000);
    expect(ticks).toEqual([WINDOW_START, WINDOW_START + 5 * 60_000, WINDOW_START + 10 * 60_000, WINDOW_END]);
  });
});

describe("upsertTraces", () => {
  it("appends new traces, updates existing ones by id, and prunes traces older than the window", () => {
    const existing = [trace("a", { started_at: at(1), status: "running", total_ms: null }), trace("old", { started_at: at(-5) })];
    const merged = upsertTraces(existing, [trace("a", { started_at: at(1), status: "ok", total_ms: 800 }), trace("b", { started_at: at(2) })], WINDOW_START);
    expect(merged.map((row) => row.id)).toEqual(["b", "a"]);
    expect(merged.find((row) => row.id === "a")).toMatchObject({ status: "ok", total_ms: 800 });
  });
});

describe("TimelineSwimlane", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props) {
    act(() => {
      root.render(React.createElement(TimelineSwimlane, { windowStart: WINDOW_START, windowEnd: WINDOW_END, nowMs: WINDOW_END, laneBy: "provider", ...props }));
    });
  }

  const bars = () => [...container.querySelectorAll('rect[role="button"]')];

  it("renders one lane per provider and one focusable bar per trace with a tooltip", () => {
    render({
      traces: [
        trace("t1", { provider: "codex" }),
        trace("t2", { provider: "claude", started_at: at(4), status: "error", model: "claude-sonnet-4-5", total_ms: 900, event_count: 4 }),
        trace("t3", { provider: "codex", started_at: at(8), total_ms: 1 }),
      ],
      onSelect: vi.fn(),
    });
    const rendered = bars();
    expect(rendered).toHaveLength(3);
    expect(rendered.map((bar) => bar.getAttribute("data-lane"))).toEqual(["codex", "claude", "codex"]);
    expect(rendered.every((bar) => bar.getAttribute("tabindex") === "0")).toBe(true);
    expect(rendered[1].querySelector("title").textContent).toBe("claude-sonnet-4-5 · error · 900 ms · 4 events");
    expect(rendered[1].getAttribute("class")).toContain("fill-dd-danger");
    expect(Number(rendered[2].getAttribute("width"))).toBe(MIN_BAR_WIDTH);
    expect(container.textContent).toContain("claude");
    expect(container.textContent).toContain("codex");
  });

  it("draws the overflow lane as 'other' when more than MAX_LANES values exist", () => {
    const traces = Array.from({ length: MAX_LANES + 3 }, (_, i) => trace(`t${i}`, { provider: `p${String(i).padStart(2, "0")}`, started_at: at(1 + i / 2) }));
    render({ traces, onSelect: vi.fn() });
    const lanes = new Set(bars().map((bar) => bar.getAttribute("data-lane")));
    expect(lanes.size).toBe(MAX_LANES);
    expect(lanes.has(OTHER_LANE)).toBe(true);
    expect(container.textContent).toContain("other");
  });

  it("selects a trace on click, Enter, and Space", () => {
    const onSelect = vi.fn();
    render({ traces: [trace("t1"), trace("t2", { started_at: at(3) })], onSelect });
    const [first, second] = bars();
    act(() => { first.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    act(() => { second.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => { first.dispatchEvent(space); });
    act(() => { first.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })); });
    expect(onSelect.mock.calls).toEqual([["t1"], ["t2"], ["t1"]]);
    expect(space.defaultPrevented).toBe(true);
  });

  it("shows the empty state when no trace falls inside the window", () => {
    render({ traces: [trace("old", { started_at: at(-30) })], onSelect: vi.fn(), emptyState: { title: "Timeline capture is off" } });
    expect(bars()).toHaveLength(0);
    expect(container.textContent).toContain("Timeline capture is off");
  });
});
