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
        "GET /api/monitoring": { body: { version: "4.11.0", latencyMs: 12, runtime: { processUptimeSec: 3600, nodeVersion: "v20.20.2", dbSizeLabel: "12 MB", activeDetail: [{ provider: "openai", model: "gpt-5", account: "Primary", count: 2 }] }, activity: { today: { requests: 123, promptTokens: 1400, completionTokens: 900, providers: 1, models: 1 } }, health: [{ id: "openai", name: "OpenAI", requests: 123, errors: 1, successRate: 99.2 }] }, status: 200 },
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
    await expect(canvas.getByText("Gateway")).toBeVisible();
    await expect(canvas.getByText("openai · gpt-5 · Primary")).toBeVisible();
    await expect(canvas.getByText("OpenAI")).toBeVisible();
  },
};
