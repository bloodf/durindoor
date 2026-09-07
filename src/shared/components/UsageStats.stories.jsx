import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import UsageStats from "./UsageStats.js";

const stats = {
  totalRequests: 12,
  byModel: {
    "gpt-4": { rawModel: "gpt-4", provider: "openai", requests: 10, promptTokens: 1200, completionTokens: 340, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0.02, inputCost: 0.01, cachedCost: 0, cacheCreationCost: 0, outputCost: 0.01, reasoningCost: 0, lastUsed: "2026-01-01T00:00:00Z" },
  },
  byProvider: { openai: { requests: 10, promptTokens: 1200, completionTokens: 340, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0.02 } },
  byAccount: {}, byApiKey: {}, byEndpoint: {}, pending: { byModel: {} }, activeRequests: [], activeSessions: [], recentRequests: [], errorProvider: "",
};

const baseFixture = {
  scenario: "default",
  pathname: "/dashboard/usage",
  params: {},
  routes: {
    "GET /api/usage/stats": { body: stats, status: 200 },
    // The fixture serializes each event entry as the SSE `data` payload, and
    // UsageStats replaces its whole snapshot with that parsed object, so the
    // event must be the stats payload itself, not a { data } wrapper.
    "GET /api/usage/stream": { events: [stats] },
    "GET /api/providers": { body: { connections: [] }, status: 200 },
    "GET /api/provider-nodes": { body: { nodes: [] }, status: 200 },
    "GET /api/settings": { body: { disabledFreeProviders: [] }, status: 200 },
  },
};

const meta = { title: "Production/shared-analytics/UsageStats", component: UsageStats, parameters: { layout: "padded" } };
export default meta;

export const Default = {
  args: { hidePeriodSelector: false },
  parameters: { storyFixture: baseFixture },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("gpt-4")).toBeVisible());
    // UsageStats starts in model view; its provider column calls
    // neutralProviderBadge(), which renders this neutral Badge.
    await expect(canvas.getByText("openai")).toBeVisible();
    await userEvent.click(canvas.getByRole("combobox", { name: /usage grouping/i }));
    await waitFor(() => expect(within(document.body).getByRole("listbox")).toBeVisible());
  }
};

export const CustomRange = {
  args: { period: "custom", customRange: { startDate: "2026-01-01", endDate: "2026-01-05" }, isCustomRange: true, hidePeriodSelector: true },
  parameters: { storyFixture: baseFixture },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText(/Chart shows preset ranges only/i)).toBeVisible());
  },
};

export const FailedStats = {
  name: "Persistent loading",
  args: { hidePeriodSelector: true },
  parameters: {
    storyFixture: {
      ...baseFixture,
      routes: {
        ...baseFixture.routes,
        "GET /api/usage/stats": () => new Promise(() => {}),
        "GET /api/usage/stream": { body: stats, status: 200, events: [] },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const spinners = await canvas.findAllByRole("status");
    expect(spinners).toHaveLength(4);
    for (const spinner of spinners) {
      await expect(spinner).toHaveTextContent("Loading usage statistics");
    }
  },
};
