import React from "react";
import { expect, userEvent, within } from "storybook/test";
import MonitoringPage from "./page.js";

const snapshot = { runtime: { processUptimeSec: 3660, nodeVersion: "v24", memoryRssMB: 128, dbSizeLabel: "2 MB" }, activity: { today: { requests: 12, promptTokens: 200, completionTokens: 80, providers: 2, models: 3 } }, latencyMs: 12, version: "5.0" };
export default { title: "Production/monitoring/MonitoringPage", component: MonitoringPage, parameters: { storyFixture: { pathname: "/dashboard/monitoring", routes: { "GET /api/monitoring": { body: snapshot } } } } };
export const Loaded = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByRole("heading", { name: "Monitoring" })).toBeVisible(); await expect(await canvas.findByText("Gateway latency")).toBeVisible(); } };
export const RequestFailure = { parameters: { storyFixture: { routes: { "GET /api/monitoring": (() => { let reads = 0; return async () => (++reads === 1 ? { body: snapshot } : { status: 503, body: {} }); })() } } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await canvas.findByText("Gateway latency"); await userEvent.click(canvas.getByRole("button", { name: "Refresh monitoring" })); await expect(await canvas.findByRole("alert")).toBeVisible(); await expect(canvas.getByText("Gateway latency")).toBeVisible(); } };
export const Loading = { parameters: { storyFixture: { routes: { "GET /api/monitoring": () => new Promise(() => {}) } } }, play: async ({ canvasElement }) => { await within(canvasElement).findByRole("status"); } };
export const PausePolling = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); await canvas.findByRole("button", { name: "Live" }); await userEvent.click(canvas.getByRole("button", { name: "Live" })); await expect(await canvas.findByRole("button", { name: "Paused" })).toHaveAttribute("aria-pressed", "false"); } };
