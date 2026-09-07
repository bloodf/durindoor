import React from "react";
import { expect, within } from "storybook/test";
import { Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { chartTooltipContentStyle, chartTooltipLabelStyle, chartTooltipItemStyle } from "./chartTooltip.js";

const data = [
  { date: "2026-01-01", tokens: 12 },
  { date: "2026-01-02", tokens: 18 },
  { date: "2026-01-03", tokens: 9 },
];

function TooltipChart({ formatter, labelFormatter }) {
  return (
    <div className="rounded-dd-lg border border-dd-border bg-dd-surface p-4 text-dd-text">
      <p className="mb-3 text-[13px] font-medium">Usage tooltip preview</p>
      <LineChart width={360} height={220} data={data} aria-label="Token usage chart">
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip contentStyle={chartTooltipContentStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} formatter={formatter} labelFormatter={labelFormatter} />
        <Line type="monotone" dataKey="tokens" stroke="var(--dd-accent)" strokeWidth={2} dot />
      </LineChart>
    </div>
  );
}

const meta = {
  title: "Production/shared-analytics/ChartTooltip",
  component: TooltipChart,
  parameters: { layout: "centered" },
};
export default meta;

// This non-component export is visual only through real Recharts consumers; these scenarios render its three shared style objects through Tooltip.
export const Tokens = {
  args: { formatter: (value) => [`${value}`, "Tokens"] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Token usage chart")).toBeVisible();
  },
};

export const Bytes = {
  args: { formatter: (value) => [`${value}B`, "Bytes"], labelFormatter: (d) => `Date: ${d}` },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Usage tooltip preview")).toBeVisible();
  },
};
