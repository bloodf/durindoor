import React, { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import TimelineSwimlane from "./TimelineSwimlane.jsx";

const WINDOW_START = Date.parse("2026-09-05T12:00:00.000Z");
const WINDOW_END = WINDOW_START + 15 * 60_000;
const at = (minutes) => new Date(WINDOW_START + minutes * 60_000).toISOString();

const traces = [
  { id: "trace-001", started_at: at(1), status: "ok", provider: "codex", model: "gpt-5", connection_id: "conn-a", event_count: 12, total_ms: 42_000 },
  { id: "trace-002", started_at: at(3.5), status: "error", provider: "claude", model: "claude-sonnet-4-5", connection_id: "conn-b", event_count: 4, total_ms: 900 },
  { id: "trace-003", started_at: at(6), status: "aborted", provider: "codex", model: "gpt-5-mini", connection_id: "conn-a", event_count: 7, total_ms: 18_000 },
  { id: "trace-004", started_at: at(9), status: "ok", provider: "gemini", model: "gemini-2.5-pro", connection_id: "conn-c", event_count: 20, total_ms: 95_000 },
  { id: "trace-005", started_at: at(13), status: "running", provider: "claude", model: "claude-opus-4-1", connection_id: "conn-b", event_count: 3, total_ms: null },
];

export default {
  title: "Production/timeline/TimelineSwimlane",
  component: TimelineSwimlane,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/timeline" } },
  args: { traces, windowStart: WINDOW_START, windowEnd: WINDOW_END, nowMs: WINDOW_END, laneBy: "provider", onSelect: fn() },
};

export const Default = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("group", { name: "Trace swimlanes by provider" })).toBeVisible();
    const bars = canvas.getAllByRole("button");
    await expect(bars).toHaveLength(traces.length);
    const bar = canvas.getByRole("button", { name: /claude-sonnet-4-5 · error · 900 ms · 4 events/ });
    bar.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onSelect).toHaveBeenCalledWith("trace-002");
  },
};

function LiveAppendHarness(props) {
  const [rows, setRows] = useState(props.traces);
  const append = () => setRows((current) => [
    ...current,
    { id: `live-${current.length}`, started_at: at(14), status: "ok", provider: "openrouter", model: "deepseek-r1", connection_id: "conn-d", event_count: 5, total_ms: 12_000 },
  ]);
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={append} className="inline-flex min-h-11 w-fit items-center rounded-dd border border-dd-border px-3 text-[13px] text-dd-text outline-none focus-visible:shadow-dd-focus">
        Simulate live trace
      </button>
      <TimelineSwimlane {...props} traces={rows} />
    </div>
  );
}

export const LiveAppend = {
  render: (args) => <LiveAppendHarness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Simulate live trace" }));
    await expect(await canvas.findByRole("button", { name: /deepseek-r1 · ok · 12000 ms · 5 events/ })).toBeVisible();
    await expect(canvasElement.querySelector('[data-lane="openrouter"]')).not.toBeNull();
  },
};

export const Empty = {
  args: { traces: [] },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No traces in this window")).toBeVisible();
  },
};
