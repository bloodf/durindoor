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
