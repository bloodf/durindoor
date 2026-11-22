import React from "react";
import { expect, within } from "storybook/test";
import QuotaPage from "./page";
import QuotaLoading from "./QuotaLoading";

const routes = {
  "GET /api/providers/client": { body: { connections: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, totals: { eligibleConnections: 0, providerFilteredConnections: 0 }, providerOptions: [] } },
  "GET /api/settings": { body: { quotaTrackerState: {}, disabledFreeProviders: [] } },
  "PATCH /api/settings": { body: {} },
  "GET /api/proxy-pools": { body: { proxyPools: [] } },
};

export default { title: "Production/operations/QuotaPage", component: QuotaPage, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/quota", routes } } };


export const EmptyProviders = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByText(/No Providers Connected/i)).toBeInTheDocument(); } };

export const Loading = {
  render: () => <QuotaLoading />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll(".animate-pulse")).toHaveLength(2);
  },
};

const account = (id, name, email) => ({ id, provider: "codex", name, email, authType: "oauth", isActive: true, providerSpecificData: { plan: "Pro" } });
const accounts = [account("codex-primary", "Primary Codex", "owner@example.com"), account("codex-secondary", "Secondary Codex", "second@example.com")];
const accountRoutes = (primary) => ({
  "GET /api/providers/client": () => ({ body: { connections: accounts, pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 }, totals: { eligibleConnections: 2, providerFilteredConnections: 2 }, providerOptions: ["codex"] } }),
  "GET /api/settings": () => ({ body: { quotaTrackerState: {}, claudeAutoPing: { connections: {} }, codexAutoPing: { connections: {} }, quotaVisibility: {} } }),
  "GET /api/proxy-pools": () => ({ body: { proxyPools: [] } }),
  "GET /api/usage/codex-primary": primary,
  "GET /api/usage/codex-secondary": () => ({ body: { plan: "Pro", rate_limit: { primary_window: { used_percent: 20, reset_at: Date.now() + 3_600_000 } } } }),
});

export const AccountRows = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/quota", routes: accountRoutes(() => ({ body: { plan: "Pro", rate_limit: { primary_window: { used_percent: 35, reset_at: Date.now() + 3_600_000 } } } })) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("region", { name: /owner@example\.com/ })).toBeVisible();
    await expect(canvas.getByRole("region", { name: /second@example\.com/ })).toBeVisible();
  },
};

export const QuotaFailure = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/quota", routes: accountRoutes(() => ({ status: 503, body: { error: "Quota service unavailable" } })) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/Quota service unavailable/)).toBeVisible();
    await expect(within(canvas.getByRole("region", { name: /second@example\.com/ })).queryByRole("alert")).not.toBeInTheDocument();
    await expect(canvas.getByRole("region", { name: /second@example\.com/ })).toBeVisible();
    await expect(canvas.getAllByRole("button", { name: "Refresh quota" }).length).toBeGreaterThan(0);
  },
};
