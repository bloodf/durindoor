import React from "react";
import { expect, userEvent, within } from "storybook/test";
import MonitoringWidgets from "./MonitoringWidgets";

const status = { version: "4.11.0", latencyMs: 12, runtime: { processUptimeSec: 3600, dbSizeLabel: "12 MB", activeDetail: [{ provider: "openai", model: "gpt-5", account: "Primary", count: 2 }] }, activity: { today: { requests: 123 } }, health: [{ id: "openai", name: "OpenAI", requests: 123, errors: 1, successRate: 99.2 }] };
let monitoringCalls = 0;
export default { title: "Production/usage/Monitoring widgets", component: MonitoringWidgets, parameters: { layout: "padded", storyFixture: { pathname: "/dashboard/usage", scenario: "default", routes: { "GET /api/monitoring": { body: status, status: 200 } } } } };
export const Default = {};
export const Empty = { parameters: { storyFixture: { pathname: "/dashboard/usage", scenario: "default", routes: { "GET /api/monitoring": { body: { runtime: {}, activity: {}, health: [] }, status: 200 } } } } };
export const Recovery = {
  beforeEach: () => { monitoringCalls = 0; },
  parameters: { storyFixture: { pathname: "/dashboard/usage", scenario: "default", routes: { "GET /api/monitoring": () => ++monitoringCalls === 1 ? { body: {}, status: 503 } : { body: status, status: 200 } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("alert")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Refresh" }));
    await expect(await canvas.findByText("Online")).toBeVisible();
  },
};
