import React, { Suspense } from "react";
import { expect, within, waitFor } from "storybook/test";
import UsagePage from "./page.js";

const emptyStats = {
  totalRequests: 0,
  totalPromptTokens: 0,
  totalCachedTokens: 0,
  totalCompletionTokens: 0,
  totalCost: 0,
  byModel: {},
  byProvider: {},
  byAccount: {},
  byApiKey: {},
  byEndpoint: {},
  pending: { byModel: {}, byAccount: {} },
  activeRequests: [],
  recentRequests: [],
  activeSessions: [],
};

const emptyCombos = { boundary: "Tracked combinations since 2024-04-01", rows: [] };

const providersRoute = { body: { connections: [] }, status: 200 };

const meta = {
  title: "Production/usage/Page",
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/usage",
      params: {},
      routes: {
        "GET /api/providers": providersRoute,
        "GET /api/provider-nodes": { body: { nodes: [] }, status: 200 },
        "GET /api/settings": { body: { enableObservability: true }, status: 200 },
        "GET /api/usage/stats": () => ({ body: emptyStats, status: 200 }),
        "GET /api/usage/combos": () => ({ body: emptyCombos, status: 200 }),
        "GET /api/usage/chart": () => ({ body: [], status: 200 }),
      },
    },
  },
};

export default meta;

export const Overview = {
  render: () => (
    <Suspense fallback={<div>Loading…</div>}>
      <UsagePage />
    </Suspense>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("Total requests")).toBeInTheDocument());
    await expect(canvas.getByText("Overview")).toBeVisible();
  },
};
