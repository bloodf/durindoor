import React from "react";
import { expect, within } from "storybook/test";

import MonitoringStrip from "./MonitoringStrip";

const populated = {
  runtime: { activeRequests: 3, memoryRssMB: 256, processUptimeSec: 3661 },
  health: [
    { id: "openai", name: "OpenAI", requests: 1240, errors: 2, successRate: 99.8, lastUsed: "2026-10-07T10:00:00Z" },
    { id: "offline", name: "Offline provider", requests: 4, errors: 4, successRate: 0, lastUsed: "07-10-2026 10:00:00" },
  ],
  activity: { recent: [{ provider: "OpenAI", model: "gpt-5", status: "200", timestamp: "2026-10-07T10:00:00Z" }, { provider: "Offline provider", model: "fallback", status: "500", timestamp: "not-a-date" }] },
};

const meta = {
  title: "Production/endpoint/MonitoringStrip",
  component: MonitoringStrip,
  parameters: { layout: "padded" },
};

export default meta;

export const Populated = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/endpoint", routes: { "GET /api/monitoring": { body: populated } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Active Requests")).toBeVisible();
    const health = within(await canvas.findByRole("table"));
    const healthyProvider = within(health.getByRole("row", { name: /OpenAI/ }));
    const offlineProvider = within(health.getByRole("row", { name: /Offline provider/ }));
    await expect(healthyProvider.getByRole("cell", { name: "OpenAI" })).toBeVisible();
    await expect(healthyProvider.getByRole("cell", { name: "99.8%" })).toBeVisible();
    await expect(offlineProvider.getByRole("cell", { name: "0%" })).toBeVisible();
    await expect(await canvas.findByText("fallback")).toBeVisible();
  },
};

export const EmptyAndError = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/endpoint", routes: { "GET /api/monitoring": { status: 503, body: { error: "Unavailable" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("HTTP 503")).toBeVisible();
    await expect(await canvas.findByText("No provider activity recorded yet.")).toBeVisible();
    await expect(await canvas.findByText("No request logs yet.")).toBeVisible();
  },
};
