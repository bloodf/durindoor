// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import TraceWaterfall, { buildWaterfallRows, waterfallSpan } from "@/app/(dashboard)/dashboard/timeline/[id]/components/TraceWaterfall.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const events = [
  { seq: 1, t_ms: 0, type: "request", direction: "out", summary: "POST /v1/chat/completions", payload: { model: "gpt-5" } },
  { seq: 2, t_ms: 300, type: "sse_chunk", direction: "in", summary: "open", payload: "data: {}" },
  { seq: 3, t_ms: 340, type: "sse_chunk", direction: "in", summary: "delta", payload: "data: {\"a\":1}" },
  { seq: 4, t_ms: 380, type: "sse_chunk", direction: "in", summary: "delta", payload: "data: {\"a\":2}" },
  { seq: 5, t_ms: 900, type: "response", direction: "in", summary: "200", payload: { status: 200 } },
  { seq: 6, t_ms: 950, type: "sse_chunk", direction: "system", summary: "trailer", payload: null },
];

describe("buildWaterfallRows", () => {
  it("collapses consecutive sse_chunk events into one 'N chunks' row", () => {
    const rows = buildWaterfallRows(events, 1200);
    expect(rows.map((row) => row.label)).toEqual(["#1 request", "3 chunks", "#5 response", "#6 sse_chunk"]);
    expect(rows[1].events.map((event) => event.seq)).toEqual([2, 3, 4]);
    expect(rows.map((row) => row.direction)).toEqual(["out", "in", "in", "system"]);
  });

  it("orders rows by seq regardless of input order", () => {
    const rows = buildWaterfallRows([...events].reverse(), 1200);
    expect(rows.map((row) => row.events[0].seq)).toEqual([1, 2, 5, 6]);
  });

  it("ends each bar at the next row's t_ms and the last bar at trace.total_ms", () => {
    const rows = buildWaterfallRows(events, 1200);
    expect(rows.map((row) => [row.startMs, row.endMs])).toEqual([[0, 300], [300, 900], [900, 950], [950, 1200]]);
    expect(waterfallSpan(rows, 1200)).toBe(1200);
  });

  it("ends the last bar at its own t_ms while the trace is still running", () => {
    const rows = buildWaterfallRows(events.slice(0, 4), null);
    expect(rows.at(-1)).toMatchObject({ label: "3 chunks", startMs: 300, endMs: 380 });
    expect(waterfallSpan(rows, null)).toBe(380);
  });

  it("never produces a negative bar when total_ms is earlier than the last event", () => {
    const rows = buildWaterfallRows(events, 100);
    expect(rows.at(-1)).toMatchObject({ startMs: 950, endMs: 950 });
  });
});

describe("TraceWaterfall", () => {
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

  it("renders one row per group and expands EventRow detail on click", () => {
    act(() => { root.render(React.createElement(TraceWaterfall, { trace: { total_ms: 1200 }, events })); });
    const rows = [...container.querySelectorAll('ol[aria-label="Trace waterfall"] > li > button')];
    expect(rows).toHaveLength(4);
    expect(rows[1].textContent).toContain("3 chunks");
    expect(rows[3].textContent).toContain("950–1200 ms");
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(0);

    act(() => { rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(rows[1].getAttribute("aria-expanded")).toBe("true");
    const regions = [...container.querySelectorAll('[role="region"]')].map((node) => node.getAttribute("aria-label"));
    expect(regions).toEqual(["Timeline event #2 details", "Timeline event #3 details", "Timeline event #4 details"]);

    act(() => { rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(rows[1].getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(0);
  });

  it("colours bars by direction", () => {
    act(() => { root.render(React.createElement(TraceWaterfall, { trace: { total_ms: 1200 }, events })); });
    const fills = [...container.querySelectorAll("[data-waterfall-bar]")].map((bar) => bar.className);
    expect(fills[0]).toContain("bg-dd-accent");
    expect(fills[1]).toContain("bg-dd-info");
    expect(fills[3]).toContain("bg-dd-muted");
  });
});
