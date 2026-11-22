import React, { Suspense } from "react";
import { expect, userEvent, within, waitFor } from "storybook/test";
import UsagePage from "./page.js";
import { USAGE_LAYOUT_KEY } from "@/shared/ui/v5/usage/layout.js";
import { usageFixture } from "@/shared/ui/v5/usage/fixtures.js";

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
  title: "Production/usage/Layout",
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
        // Combo and key-limit reports render as widgets when the V5 switch is on.
        "GET /api/usage/combos": usageFixture.routes["GET /api/usage/combos"],
        "GET /api/keys": usageFixture.routes["GET /api/keys"],
        "GET /api/keys/usage": usageFixture.routes["GET /api/keys/usage"],
      },
    },
  },
};

export default meta;

const v5Globals = { ui: "v5" };
const renderPage = () => (
  <Suspense fallback={<div>Loading…</div>}>
    <UsagePage />
  </Suspense>
);
const clearLayout = () => { try { window.localStorage.removeItem(USAGE_LAYOUT_KEY); } catch { /* storage may be blocked */ } };
const layoutNotice = (canvasElement) => canvasElement.querySelector(".v5-usage-layout-notice");
const widgetIds = (canvasElement) => [...canvasElement.querySelectorAll("[data-widget-id]")].map((node) => node.getAttribute("data-widget-id"));

/** V5 places every report in the widget layout; the saved layout key is absent until Save. */
export const OverviewWidgets = {
  globals: v5Globals,
  render: renderPage,
  play: async ({ canvasElement }) => {
    clearLayout();
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("Total requests")).toBeInTheDocument());
    for (const name of ["Usage overview", "Provider connections", "Grouped usage", "Gateway monitoring"]) await expect(canvas.getByRole("region", { name })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Customize dashboard" })).toBeVisible();
  },
};

/** Draft reorder then Cancel restores the saved order and writes nothing. */
export const LayoutCancelRestoresOrder = {
  globals: v5Globals,
  render: renderPage,
  play: async ({ canvasElement }) => {
    clearLayout();
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Customize dashboard" }));
    const before = widgetIds(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Move Usage overview later" }));
    await expect(widgetIds(canvasElement)).not.toEqual(before);
    await userEvent.click(canvas.getByRole("button", { name: "Cancel layout changes" }));
    await expect(widgetIds(canvasElement)).toEqual(before);
    await expect(window.localStorage.getItem(USAGE_LAYOUT_KEY)).toBeNull();
  },
};

/** Save writes only the production layout key; layout reset is its own confirm dialog. */
export const LayoutSaveAndResetConfirm = {
  globals: v5Globals,
  render: renderPage,
  play: async ({ canvasElement }) => {
    clearLayout();
    const canvas = within(canvasElement);
    try {
      await userEvent.click(await canvas.findByRole("button", { name: "Customize dashboard" }));
      await userEvent.click(canvas.getByRole("button", { name: "Move Usage overview later" }));
      await userEvent.click(canvas.getByRole("button", { name: "Reset layout" }));
      const dialog = within(await within(document.body).findByRole("dialog", { name: "Reset widget layout?" }));
      await userEvent.click(dialog.getByRole("button", { name: "Keep layout" }));
      await userEvent.click(canvas.getByRole("button", { name: "Save layout" }));
      await waitFor(() => expect(layoutNotice(canvasElement)).toHaveTextContent("Dashboard layout saved."));
      const stored = JSON.parse(window.localStorage.getItem(USAGE_LAYOUT_KEY));
      await expect(stored[0].id).not.toBe("overview");
    } finally { clearLayout(); }
  },
};

/** Blocked browser storage shows a notice and keeps the new order for this view. */
export const LayoutStorageBlocked = {
  globals: v5Globals,
  render: renderPage,
  play: async ({ canvasElement }) => {
    clearLayout();
    const canvas = within(canvasElement);
    const original = Storage.prototype.setItem;
    try {
      await userEvent.click(await canvas.findByRole("button", { name: "Customize dashboard" }));
      await userEvent.click(canvas.getByRole("button", { name: "Move Usage overview later" }));
      Storage.prototype.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
      await userEvent.click(canvas.getByRole("button", { name: "Save layout" }));
      await waitFor(() => expect(layoutNotice(canvasElement)).toHaveTextContent("Browser storage is unavailable."));
      await expect(widgetIds(canvasElement)[0]).not.toBe("overview");
    } finally { Storage.prototype.setItem = original; clearLayout(); }
  },
};

/** A failed usage read keeps the other reports mounted and offers Retry on the same URL. */
export const UsageStatsUnavailable = {
  globals: v5Globals,
  render: renderPage,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/usage",
      params: {},
      routes: { ...meta.parameters.storyFixture.routes, "GET /api/usage/stats": () => ({ body: { error: "unavailable" }, status: 500 }) },
    },
  },
  play: async ({ canvasElement }) => {
    clearLayout();
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Retry usage" })).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Gateway monitoring" })).toBeVisible();
  },
};
