import React from "react";
import { expect, userEvent, within, waitFor } from "storybook/test";
import OverviewCards from "./OverviewCards";
import UsageChart from "./UsageChart";
import RequestsPanel from "./RequestsPanel";
import ComboUsageReport from "./ComboUsageReport";
import UsageTable from "./UsageTable";
import QuotaProgressBar from "./ProviderLimits/QuotaProgressBar";
import QuotaTable from "./ProviderLimits/QuotaTable";
import ProviderLimitCard from "./ProviderLimits/ProviderLimitCard";
import RequestDetailsTab from "./RequestDetailsTab";
import ProviderTopology from "./ProviderTopology";

const meta = {
  title: "Production/usage/Usage surfaces",
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/usage",
      params: {},
      routes: {
        "GET /api/usage/chart?period=7d&tz=UTC": {
          body: [
            { label: "Sep 1", tokens: 124000, cost: 2.38 },
            { label: "Sep 2", tokens: 98000, cost: 1.77 },
            { label: "Sep 3", tokens: 142000, cost: 3.02 },
          ],
          status: 200,
        },
      },
    },
  },
};

export default meta;

export const Overview = {
  render: () => (
    <OverviewCards
      stats={{
        totalRequests: 1248,
        totalPromptTokens: 874200,
        totalCachedTokens: 120000,
        totalCompletionTokens: 245100,
        totalCost: 18.42,
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Total requests")).toBeVisible();
    await expect(canvas.getByText("1,248")).toBeVisible();
  },
};

export const RecentAndSessions = {
  render: () => (
    <RequestsPanel
      recentRequests={[
        { timestamp: new Date().toISOString(), model: "gpt-5", promptTokens: 1400, completionTokens: 230, status: "success" },
        { timestamp: new Date().toISOString(), model: "claude-opus-4-1", promptTokens: 800, completionTokens: 410, status: "error" },
      ]}
      activeSessions={[
        { requestId: "req-1", clientId: "127.0.0.1", provider: "openai", model: "gpt-5", promptTokens: 800, completionTokens: 120, status: "active" },
        { requestId: "req-2", clientId: "10.0.0.4", provider: "anthropic", model: "claude-opus-4-1", promptTokens: 220, completionTokens: 80, status: "active" },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The "In / Out" column renders through RequestsPanel's own `tokens()`
    // helper, which formats each count via formatCompactToken and exposes
    // the exact locale-formatted total as the img's accessible name.
    await expect(canvas.getByRole("img", { name: "1,400" })).toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: /Sessions/ }));
    await expect(canvas.getByText("127.0.0.1")).toBeVisible();
    await expect(canvas.getByRole("img", { name: "800" })).toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: /Recent requests/ }));
    await expect(canvas.getByText("gpt-5")).toBeVisible();
  }
};

export const UsageTrend = {
  render: () => <UsageChart period="7d" refreshKey={2} />,
};

export const UsageTrendEmpty = {
  render: () => <UsageChart period="all" refreshKey={0} />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/usage",
      params: {},
      routes: {
        "GET /api/usage/chart?period=all&tz=UTC": { body: [], status: 200 },
      },
    },
  },
};

const groupedData = [
  {
    groupKey: "gpt-5",
    summary: { requests: 421, promptTokens: 124000, cachedTokens: 12000, completionTokens: 41000, totalTokens: 165000, cost: 5.2 },
    items: [
      { key: "acc-1", rawModel: "gpt-5", provider: "openai", requests: 421, promptTokens: 124000, completionTokens: 41000, totalTokens: 165000, cost: 5.2 },
    ],
  },
  {
    groupKey: "claude-opus-4-1",
    summary: { requests: 88, promptTokens: 24000, cachedTokens: 0, completionTokens: 18000, totalTokens: 42000, cost: 2.4 },
    items: [
      { key: "acc-2", rawModel: "claude-opus-4-1", provider: "anthropic", requests: 88, promptTokens: 24000, completionTokens: 18000, totalTokens: 42000, cost: 2.4 },
    ],
  },
];

const usageGroupColumns = [
  { key: "requests", label: "Requests", align: "right", mono: true, render: (row) => row.requests?.toLocaleString() ?? "—" },
];

const usageDetailColumns = [
  { key: "rawModel", label: "Model", rowHeader: true, render: (row) => row.rawModel },
  { key: "provider", label: "Provider", render: (row) => row.provider },
];

export const UsageTableCollapsed = {
  render: () => (
    <UsageTable
      title="Usage by Model"
      groupColumns={usageGroupColumns}
      detailColumns={usageDetailColumns}
      groupedData={groupedData}
      tableType="model"
      sortBy="rawModel"
      sortOrder="asc"
      onToggleSort={() => {}}
      valueMode="tokens"
      storageKey="story:usage:model"
      emptyMessage="No usage yet"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("gpt-5")).toBeVisible();
  },
};

const pendingGroupedData = [
  {
    groupKey: "pending-openai",
    summary: { requests: 3, promptTokens: 900, cachedTokens: 0, completionTokens: 120, totalTokens: 1020, cost: 0.04, pending: 3 },
    items: [
      { key: "pending-request", rawModel: "gpt-5-pending", provider: "openai", requests: 3, promptTokens: 900, completionTokens: 120, totalTokens: 1020, cost: 0.04 },
    ],
  },
  {
    groupKey: "settled-anthropic",
    summary: { requests: 1, promptTokens: 200, cachedTokens: 0, completionTokens: 40, totalTokens: 240, cost: 0.01, pending: 0 },
    items: [
      { key: "settled-request", rawModel: "claude-settled", provider: "anthropic", requests: 1, promptTokens: 200, completionTokens: 40, totalTokens: 240, cost: 0.01 },
    ],
  },
];

export const UsageTablePending = {
  render: () => (
    <UsageTable
      title="Usage pending settlement"
      groupColumns={usageGroupColumns}
      detailColumns={usageDetailColumns}
      groupedData={pendingGroupedData}
      tableType="model"
      sortBy="rawModel"
      sortOrder="asc"
      onToggleSort={() => {}}
      valueMode="tokens"
      storageKey="story:usage:pending"
      emptyMessage="No usage yet"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("3 pending")).toBeVisible();
    await expect(canvas.getByText("settled-anthropic")).toBeVisible();
    const toggle = canvas.getByRole("button", { name: "Expand Group pending-openai" });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("table", { name: "Items for pending-openai" })).toBeVisible();
    await expect(canvas.getByText("gpt-5-pending")).toBeVisible();
  },
};

export const UsageTableCostView = {
  render: () => (
    <UsageTable
      title="Usage by Model (cost)"
      groupColumns={[{ key: "requests", label: "Requests", align: "right", mono: true, render: (row) => row.requests?.toLocaleString() ?? "—" }]}
      detailColumns={[
        { key: "rawModel", label: "Model", rowHeader: true, render: (row) => row.rawModel },
        { key: "provider", label: "Provider", render: (row) => row.provider },
      ]}
      groupedData={groupedData}
      tableType="model"
      sortBy="rawModel"
      sortOrder="asc"
      onToggleSort={() => {}}
      valueMode="costs"
      storageKey="story:usage:cost"
      emptyMessage="No usage yet"
    />
  ),
};

const comboFixture = (status) => ({
  scenario: "default",
  pathname: "/dashboard/usage",
  params: {},
  routes: {
    "GET /api/usage/combos": () => status === 200
      ? { body: { boundary: "Tracked combinations since 2024-04-01", rows: [{ comboId: "combo-1", comboName: "default-combo", connectionId: "conn-a", requests: 12, promptTokens: 1400, completionTokens: 2200, cost: 0.84 }], unattributed: { requests: 3, promptTokens: 250, completionTokens: 320, cost: 0.05 } }, status: 200 }
      : { body: { error: "internal" }, status: 500 },
  },
});

export const ComboReportLoaded = {
  render: () => <ComboUsageReport period="7d" customRange={{ startDate: "", endDate: "" }} resetNonce={1} />,
  parameters: { storyFixture: comboFixture(200) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("default-combo")).toBeVisible());
    await expect(canvas.getByText("Not attributed to a combo:")).toBeVisible();
  },
};

export const ComboReportError = {
  render: () => <ComboUsageReport period="7d" customRange={{ startDate: "", endDate: "" }} resetNonce={2} />,
  parameters: { storyFixture: comboFixture(500) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent(/Combo usage request failed/));
  },
};

export const QuotaProgressHealthy = {
  render: () => <QuotaProgressBar label="Codex Pro 5h" percentage={85} used={1500} total={10000} resetTime={new Date(Date.now() + 60 * 60 * 1000).toISOString()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("progressbar", { name: /Codex Pro 5h/ })).toHaveAttribute("aria-valuenow", "85");
  },
};

export const QuotaProgressDepleted = {
  render: () => <QuotaProgressBar label="Codex Pro 5h" percentage={3} used={9700} total={10000} resetTime={new Date(Date.now() + 60 * 60 * 1000).toISOString()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("3%")).toBeVisible();
  },
};

const quotaRows = [
  { name: "5h window", used: 1000, total: 10000, remaining: 90, resetAt: new Date(Date.now() + 3600_000).toISOString(), recurring: true },
  { name: "Weekly window", used: 4200, total: 10000, remaining: 58, resetAt: new Date(Date.now() + 86400_000 * 3).toISOString(), recurring: true },
  { name: "Bonus pack", used: 0, total: 0, remaining: 100, resetAt: null, recurring: false },
];

export const QuotaTablePaged = {
  render: () => <QuotaTable quotas={quotaRows} compact sortMode="remaining-asc" showSortLabel onHideQuota={() => {}} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Weekly window")).toBeVisible();
    await expect(canvas.getByText("Bonus pack")).toBeVisible();
  },
};

export const ProviderLimitCardHealthy = {
  render: () => <ProviderLimitCard provider="openai" name="OpenAI" plan="pro" quotas={[{ name: "5h", used: 200, total: 10000, remaining: 98, resetAt: new Date(Date.now() + 3600_000).toISOString() }]} onRefresh={() => Promise.resolve()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("OpenAI")).toBeVisible();
    await expect(canvas.getByText("pro")).toBeVisible();
  },
};

export const ProviderLimitCardMessage = {
  render: () => <ProviderLimitCard provider="github" name="GitHub Models" plan="free" quotas={[]} message="No API quota endpoint for this provider" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No API quota endpoint for this provider")).toBeVisible();
  },
};

export const ProviderLimitCardError = {
  render: () => <ProviderLimitCard provider="kiro" name="Kiro" plan="enterprise" quotas={[]} error="429 rate limited" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("429 rate limited");
  },
};

const requestDetailsFixture = (status) => ({
  scenario: "default",
  pathname: "/dashboard/usage",
  params: {},
  routes: {
    "GET /api/usage/providers": { body: { providers: [{ id: "openai", name: "OpenAI" }] }, status: 200 },
    "GET /api/provider-nodes": { body: { nodes: [] }, status: 200 },
    "GET /api/settings": { body: { enableObservability: true }, status: 200 },
    "GET /api/usage/request-details": () => status === 200
      ? { body: { details: [{ id: "r-1", timestamp: new Date().toISOString(), model: "gpt-5", provider: "openai", status: "success", tokens: { prompt_tokens: 200, completion_tokens: 80 }, latency: { ttft: 30, total: 800 }, request: { present: true, type: "json", bytes: 128 }, providerRequest: { present: false }, providerResponse: { present: true, type: "json", bytes: 256 }, response: { present: false } }], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }, status: 200 }
      : { body: { error: "boom" }, status: 500 },
  },
});

export const RequestDetailsDefault = {
  render: () => <RequestDetailsTab resetNonce={1} />,
  parameters: { storyFixture: requestDetailsFixture(200) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("gpt-5")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Detail" }));
    const body = within(document.body);
    const drawer = await waitFor(() => {
      const node = body.getByRole("dialog", { name: "Request details" });
      expect(node).toBeVisible();
      return node;
    });
    await Promise.all(drawer.getAnimations({ subtree: true }).map(({ finished }) => finished.catch(() => {})));
    const drawerScope = within(drawer);
    const payloads = await drawerScope.findByRole("button", { name: "Diagnostic payloads" });
    await expect(payloads).toHaveAttribute("aria-expanded", "true");
    await expect(drawerScope.getByText("Payloads intentionally redacted")).toBeVisible();
    await expect(drawerScope.getByText("json · 128 bytes")).toBeVisible();
    await userEvent.click(drawerScope.getByRole("button", { name: "Summary" }));
    await expect(drawerScope.getByRole("button", { name: "Summary" })).toHaveAttribute("aria-expanded", "false");
  },
};

export const RequestDetailsError = {
  render: () => <RequestDetailsTab resetNonce={1} />,
  parameters: { storyFixture: requestDetailsFixture(500) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent(/Request details failed/));
  },
};

export const ProviderTopologyConnected = {
  render: () => (
    <ProviderTopology
      providers={[
        { provider: "openai", nodeName: "OpenAI primary" },
        { provider: "anthropic", nodeName: "Anthropic" },
        { provider: "codex", nodeName: "Codex" },
      ]}
      activeRequests={[
        { provider: "openai", model: "gpt-5", count: 2, keys: [{ name: "key-1", count: 1 }, { name: "key-2", count: 1 }] },
      ]}
      lastProvider="anthropic"
      errorProvider=""
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // React Flow re-renders nodes while fitting the view, so every assertion
    // re-queries instead of holding a node that gets replaced mid-flight.
    await waitFor(() => expect(canvas.getByText("OpenAI")).toBeVisible());
    await waitFor(() => expect(canvas.getByText("Anthropic")).toBeVisible());
    await waitFor(() => expect(canvas.getByText("OpenAI Codex")).toBeVisible());
    await waitFor(() => expect(canvas.getByText("DurinDoor")).toBeVisible());
    // The tooltip is revealed by group-focus-within on the provider node
    // (ProviderTopology.js:45), so focus the node the component made focusable.
    canvas.getByText("OpenAI").closest('[aria-describedby="provider-openai-active-keys"]').focus();
    await waitFor(() => expect(canvas.getByRole("tooltip")).toBeVisible());
    await waitFor(() => expect(within(canvas.getByRole("tooltip")).getByText("gpt-5 ×2")).toBeVisible());
  },
};

export const ProviderTopologyEmpty = {
  render: () => <ProviderTopology providers={[]} activeRequests={[]} lastProvider="" errorProvider="" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No providers connected")).toBeVisible();
  },
};
