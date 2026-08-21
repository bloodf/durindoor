// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("recharts", () => ({
  AreaChart: ({ children }) => React.createElement("div", null, children),
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }) => React.createElement("div", null, children),
  Legend: () => null,
}));
vi.mock("@/shared/components/Card", () => ({ default: ({ children }) => React.createElement("div", null, children) }));

import UsageChart from "@/app/(dashboard)/dashboard/usage/components/UsageChart.js";

const response = { ok: true, json: async () => [] };

describe("UsageChart refreshKey", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(response);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("documents request count as the rolling-window refresh proxy", async () => {
    await act(async () => {
      root.render(React.createElement(UsageChart, { period: "24h", refreshKey: 4 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      // Equal count means no refresh, even if one 24h request replaced another.
      root.render(React.createElement(UsageChart, { period: "24h", refreshKey: 4 }));
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(React.createElement(UsageChart, { period: "24h", refreshKey: 5 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
