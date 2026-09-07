import React from "react";
import { expect, userEvent, within } from "storybook/test";
import HealthPage from "./page.js";

const health = { summary: { total: 2, healthy: 1, degraded: 1, down: 0, blocked: 0, unconfigured: 0 }, providers: [{ id: "openai", name: "OpenAI primary", provider: "openai", state: "healthy", statusCode: 200, latencyMs: 142 }, { id: "proxy", name: "Proxy fallback", provider: "openai", state: "degraded", statusCode: 503, latencyMs: 920, error: "Upstream timeout" }], timestamp: "2026-09-05T12:00:00.000Z" };
const headroom = { running: true, url: "http://headroom.local", circuit: { degraded: false } };
const baseRoutes = { "DELETE /api/health/providers": { body: {} }, "GET /api/headroom/status": { body: headroom } };
const meta = {
  title: "Durin DS/Production Pages/health",
  component: HealthPage,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/health", routes: { ...baseRoutes, "GET /api/health/providers": { body: health }, "GET /api/health/providers?force=1": { body: health } } } },
};
export default meta;

export const Default = {
  name: "Default",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Provider Health", level: 1 })).toBeVisible();
    const table = await canvas.findByRole("table", { name: "Configured provider connections and their reachability probes" });
    await expect(table).toBeVisible();
    await expect(await within(table).findByText("OpenAI primary")).toBeVisible();
    await expect(within(table).getByText("Healthy")).toBeVisible();
    await expect(within(table).getByText("Degraded")).toBeVisible();
    await expect(within(table).getByText("142ms")).toBeVisible();
    await expect(within(table).getByText("920ms")).toBeVisible();
    await expect(within(table).getByText("Upstream timeout")).toBeVisible();
    const refresh = canvas.getByRole("button", { name: "Refresh" });
    await userEvent.click(refresh);
    await expect(within(table).getByText("OpenAI primary")).toBeVisible();
  },
};

export const Empty = {
  name: "Empty",
  parameters: { storyFixture: { scenario: "empty", pathname: "/dashboard/health", routes: { ...baseRoutes, "GET /api/health/providers": { body: { summary: { total: 0, healthy: 0, degraded: 0, down: 0, blocked: 0, unconfigured: 0 }, providers: [] } }, "GET /api/health/providers?force=1": { body: { summary: { total: 0, healthy: 0, degraded: 0, down: 0, blocked: 0, unconfigured: 0 }, providers: [] } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = await canvas.findByRole("table", { name: "Configured provider connections and their reachability probes" });
    await expect(await within(table).findByText("No active connections")).toBeVisible();
    await expect(within(table).getByRole("button", { name: "Refresh" })).toBeVisible();
  },
};

export const LoadFailure = {
  name: "Load failure",
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/health", routes: { ...baseRoutes, "GET /api/health/providers": { status: 500, body: { error: "Health probe unavailable" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Health probe unavailable")).toBeVisible();
  },
};
