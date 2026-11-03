import { expect, userEvent, within, waitFor } from "storybook/test";
import ReviewUsagePage from "./ReviewUsagePage.jsx";
import { emptyUsageStats, usageFixture } from "./fixtures.js";
import { USAGE_WIDGETS } from "./layout.js";

const meta = {
  title: "V5 preservation/Usage/Complete usage workspace",
  component: ReviewUsagePage,
  args: { persistLayout: false },
  parameters: { layout: "fullscreen", storyFixture: usageFixture },
};
export default meta;

export const AllWidgets = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Total requests")).toBeVisible();
    for (const widget of USAGE_WIDGETS) await expect(canvas.getByRole("region", { name: widget.title })).toBeVisible();
    await expect(await canvas.findByRole("group", { name: "Control Panel" })).toBeVisible();
    await expect(await canvas.findByText("Review coding fallback")).toBeVisible();
    await expect(await canvas.findByText("Requests / minute")).toBeVisible();
    for (const label of ["Today", "24h", "7D", "30D", "60D", "90D", "180D", "365D", "All", "Custom"]) await expect(canvas.getByRole("button", { name: label, exact: true })).toBeVisible();
  },
};

/** A desktop canvas can contain phone-width widgets. Preserve their data
 * through local table scrolling rather than shrinking individual words. */
export const CompactWidgets = {
  args: { initialLayout: USAGE_WIDGETS.map((widget) => ({ ...widget, span: 4 })) },
  play: AllWidgets.play,
};

export const LayoutDraftSaveAndReopen = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Customize dashboard" }));
    await userEvent.click(canvas.getByRole("button", { name: "Edit Provider connections" }));
    const dialog = within(within(document.body).getByRole("dialog", { name: "Edit usage widget" }));
    await userEvent.clear(dialog.getByLabelText("Widget name"));
    await userEvent.type(dialog.getByLabelText("Widget name"), "My provider connections");
    await userEvent.click(dialog.getByRole("combobox", { name: "Widget width" }));
    await userEvent.click(within(document.body).getByRole("option", { name: "Full width" }));
    await userEvent.click(dialog.getByRole("button", { name: "Apply changes" }));
    await userEvent.click(canvas.getByRole("button", { name: "Move My provider connections earlier" }));
    await userEvent.click(canvas.getByRole("button", { name: "Hide API key limits" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save layout" }));
    await expect(canvas.getByRole("region", { name: "My provider connections" })).toHaveAttribute("data-span", "12");
    await expect(canvasElement.querySelector("[data-widget-id]")).toHaveAttribute("data-widget-id", "topology");
    await expect(canvas.queryByRole("region", { name: "API key limits" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Customize dashboard" }));
    await userEvent.click(canvas.getByRole("button", { name: "Add widgets" }));
    const library = within(within(document.body).getByRole("dialog", { name: "Usage widget library" }));
    await userEvent.click(library.getByRole("switch", { name: "API key limits" }));
    await userEvent.click(library.getByRole("button", { name: "Done" }));
    await expect(canvas.getByRole("region", { name: "API key limits" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Cancel layout changes" }));
    await expect(canvas.queryByRole("region", { name: "API key limits" })).toBeNull();
    await expect(canvas.getByRole("region", { name: "My provider connections" })).toBeVisible();
  },
};

export const GroupedPendingAndSessions = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const grouped = within(canvas.getByRole("region", { name: "Grouped usage" }));
    await expect(await grouped.findByText("2 pending")).toBeVisible();
    await userEvent.click(grouped.getByRole("combobox", { name: "Usage grouping" }));
    await userEvent.click(within(document.body).getByRole("option", { name: "Usage by Account" }));
    await expect(await grouped.findByText("Review account")).toBeVisible();
    const expanded = grouped.queryByRole("button", { name: "Collapse Group Review account" });
    if (expanded) await userEvent.click(expanded);
    await userEvent.click(grouped.getByRole("button", { name: "Expand Group Review account" }));
    await expect(grouped.getByRole("button", { name: "Collapse Group Review account" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(grouped.getByRole("radio", { name: "Tokens", exact: true }));
    await expect(grouped.getAllByText("Cache Write").length).toBeGreaterThan(0);
    const requests = within(canvas.getByRole("region", { name: "Recent requests and sessions" }));
    await userEvent.click(requests.getByRole("tab", { name: "Sessions" }));
    await expect(await requests.findByText("review-client")).toBeVisible();
    await expect(requests.getByText("1 active")).toBeVisible();
  },
};

export const CustomRangeKeepsLiveSessions = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Total requests")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Custom", exact: true }));
    const calendar = within(canvas.getByRole("dialog", { name: "Custom date range" }));
    await userEvent.clear(calendar.getByLabelText("From"));
    await userEvent.type(calendar.getByLabelText("From"), "2026-09-01");
    await userEvent.clear(calendar.getByLabelText("To"));
    await userEvent.type(calendar.getByLabelText("To"), "2026-09-30");
    await userEvent.click(calendar.getByRole("button", { name: "Apply" }));
    await expect(await canvas.findByText("Chart shows preset ranges only — pick a preset to view graph.")).toBeVisible();
    await waitFor(() => expect(within(canvas.getByRole("region", { name: "Usage overview" })).getByText("27")).toBeVisible());
    const requests = within(canvas.getByRole("region", { name: "Recent requests and sessions" }));
    await userEvent.click(requests.getByRole("tab", { name: "Sessions" }));
    await expect(requests.getByText("review-client")).toBeVisible();
  },
};

export const RequestDetails = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "Details", exact: true }));
    await expect(await canvas.findByRole("button", { name: "Detail", exact: true })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Detail", exact: true }));
    await expect(await within(document.body).findByRole("dialog", { name: "Request details" })).toBeVisible();
  },
};

export const ResetUsageData = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Reset", exact: true }));
    const dialog = within(within(document.body).getByRole("dialog", { name: "Reset usage data" }));
    await waitFor(() => expect(dialog.getByText("Select how far back to delete usage data. This action cannot be undone.")).toBeVisible());
    await userEvent.click(dialog.getByRole("combobox", { name: "Usage reset period" }));
    await userEvent.click(within(document.body).getByRole("option", { name: "1 hour", exact: true }));
    await userEvent.click(dialog.getByRole("button", { name: "Reset", exact: true }));
    await waitFor(() => expect(within(document.body).queryByRole("dialog", { name: "Reset usage data" })).toBeNull());
    await expect(canvas.getByText("Total requests")).toBeVisible();
  },
};

export const StatsFailureKeepsIndependentReports = {
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "GET /api/usage/stats": { status: 503, body: { error: "Usage statistics unavailable" } },
    "GET /api/usage/stream": { events: [] },
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findAllByRole("alert"))[0]).toHaveTextContent("Usage statistics could not be refreshed.");
    await expect(canvas.getByRole("button", { name: "Retry usage" })).toBeVisible();
    await expect(await canvas.findByText("Review coding fallback")).toBeVisible();
    await expect(await canvas.findByText("Requests / minute")).toBeVisible();
  },
};

export const RequestLogs = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "Logs", exact: true }));
    await expect(await canvas.findByRole("combobox", { name: "Logs per page" })).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Auto refresh every 3 seconds" })).toBeVisible();
  },
};

/** A pending stats request and an idle stream expose the actual loading branch. */
export const LoadingStatistics = {
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "GET /api/usage/stats": () => new Promise(() => {}),
    "GET /api/usage/stream": { events: [] },
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const title of ["Usage overview", "Provider connections", "Recent requests and sessions", "Token and cost trend", "Grouped usage"]) {
      await expect(await within(canvas.getByRole("region", { name: title })).findByRole("status")).toHaveTextContent("Loading usage statistics");
    }
    await expect(await canvas.findByText("Review coding fallback")).toBeVisible();
    await expect(await canvas.findByText("Requests / minute")).toBeVisible();
  },
};

export const ComboReportError = {
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "GET /api/usage/combos": { status: 503, body: { error: "Combo report unavailable" } },
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await within(canvas.getByRole("region", { name: "Combo connection usage" })).findByRole("alert")).toHaveTextContent("Combo usage request failed: 503");
    await expect(await canvas.findByText("Total requests")).toBeVisible();
    await expect(await canvas.findByText("Requests / minute")).toBeVisible();
  },
};

export const RequestLogsError = {
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "GET /api/usage/request-logs": { status: 503, body: { error: "Request logs unavailable" } },
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "Logs", exact: true }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Failed to load request logs.");
    await expect(canvas.getByRole("switch", { name: "Auto refresh every 3 seconds" })).toBeVisible();
  },
};

export const ResetPending = {
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "POST /api/usage/reset": async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return { body: { success: true } };
    },
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const overview = canvas.getByRole("region", { name: "Usage overview" });
    await waitFor(() => expect(within(overview).getByText("12", { exact: true })).toBeVisible());
    const previous = overview.textContent;
    await userEvent.click(canvas.getByRole("button", { name: "Reset", exact: true }));
    const modal = within(document.body).getByRole("dialog", { name: "Reset usage data" });
    const dialog = within(modal);
    await userEvent.click(dialog.getByRole("button", { name: "Reset", exact: true }));
    await expect(dialog.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Reset", exact: true })).toHaveAttribute("aria-busy", "true");
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("combobox", { name: "Usage reset period" })).toBeDisabled();
    await expect(dialog.getByRole("status")).toHaveTextContent("Resetting usage data…");
    await expect(overview.textContent).toBe(previous);
    await userEvent.keyboard("{Escape}");
    await expect(modal).toBeVisible();
    await waitFor(() => expect(within(document.body).queryByRole("dialog", { name: "Reset usage data" })).toBeNull(), { timeout: 3000 });
    await expect(await canvas.findByText("Total requests")).toBeVisible();
  },
};

export const ResetFailure = {
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "POST /api/usage/reset": { status: 503, body: { error: "Reset unavailable" } },
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const overview = canvas.getByRole("region", { name: "Usage overview" });
    await waitFor(() => expect(within(overview).getByText("12", { exact: true })).toBeVisible());
    const previous = overview.textContent;
    await userEvent.click(canvas.getByRole("button", { name: "Reset", exact: true }));
    const dialog = within(within(document.body).getByRole("dialog", { name: "Reset usage data" }));
    await userEvent.click(dialog.getByRole("combobox", { name: "Usage reset period" }));
    await userEvent.click(within(document.body).getByRole("option", { name: "1 hour", exact: true }));
    await userEvent.click(dialog.getByRole("button", { name: "Reset", exact: true }));
    await expect(await dialog.findByRole("alert")).toHaveTextContent("Reset failed. Your displayed usage is unchanged. Try again.");
    await expect(dialog.getByRole("button", { name: "Reset", exact: true })).toBeEnabled();
    await expect(dialog.getByRole("combobox", { name: "Usage reset period" })).toHaveTextContent("1 hour");
    await expect(overview.textContent).toBe(previous);
    await userEvent.click(dialog.getByRole("button", { name: "Cancel", exact: true }));
    await expect(canvas.getByText("Total requests")).toBeVisible();
    await expect(within(overview).getByText("12", { exact: true })).toBeVisible();
  },
};

export const LoadingReports = {
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "GET /api/usage/chart": () => new Promise(() => {}),
    "GET /api/usage/combos": () => new Promise(() => {}),
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await within(canvas.getByRole("region", { name: "Token and cost trend" })).findByText("Loading…")).toBeVisible();
    const combo = within(canvas.getByRole("region", { name: "Combo connection usage" }));
    await expect(combo.getByRole("table")).toHaveAttribute("aria-busy", "true");
    await expect(combo.getByText("Loading attribution boundary…")).toBeVisible();
    await expect(await canvas.findByText("Requests / minute")).toBeVisible();
  },
};

export const LoadingRequestDetails = {
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "GET /api/usage/request-details": () => new Promise(() => {}),
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "Details", exact: true }));
    await waitFor(() => expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "true"));
    await expect(canvas.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  },
};

export const LoadingRequestLogs = {
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "GET /api/usage/request-logs": () => new Promise(() => {}),
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "Logs", exact: true }));
    await waitFor(() => expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "true"));
    await expect(canvas.getByRole("switch", { name: "Auto refresh every 3 seconds" })).toBeVisible();
  },
};

export const EmptyStatistics = {
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "GET /api/usage/stats": { body: emptyUsageStats },
    "GET /api/usage/stream": { events: [emptyUsageStats] },
    "GET /api/usage/chart": { body: [] },
    "GET /api/usage/combos": { body: { boundary: "Recorded combo attribution in the selected range", rows: [] } },
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await within(canvas.getByRole("region", { name: "Grouped usage" })).findByText("No usage recorded yet.")).toBeVisible();
    await expect(await canvas.findByText("No data for this period")).toBeVisible();
    await expect(await canvas.findByText("No attributed combo usage in this range")).toBeVisible();
    const requests = within(canvas.getByRole("region", { name: "Recent requests and sessions" }));
    await expect(requests.getByText("No requests yet")).toBeVisible();
    await userEvent.click(requests.getByRole("tab", { name: "Sessions" }));
    await expect(requests.getByText("No active sessions")).toBeVisible();
    await expect(await canvas.findByText("Requests / minute")).toBeVisible();
  },
};

let offlineStreams = [];

/** Exercise the real onerror handler after a fixture SSE snapshot; no offline badge exists in production. */
export const StreamOfflineRetainsSnapshot = {
  beforeEach: () => {
    const FixtureEventSource = globalThis.EventSource;
    offlineStreams = [];
    globalThis.EventSource = class extends FixtureEventSource {
      constructor(url) { super(url); offlineStreams.push(this); }
    };
    return () => { globalThis.EventSource = FixtureEventSource; offlineStreams = []; };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const overview = canvas.getByRole("region", { name: "Usage overview" });
    await waitFor(() => expect(within(overview).getByText("12", { exact: true })).toBeVisible());
    const previous = overview.textContent;
    await expect(offlineStreams.length).toBeGreaterThan(0);
    for (const stream of offlineStreams) stream.dispatchEvent(new Event("error"));
    await expect(overview.textContent).toBe(previous);
    const requests = within(canvas.getByRole("region", { name: "Recent requests and sessions" }));
    await userEvent.click(requests.getByRole("tab", { name: "Sessions" }));
    await expect(requests.getByText("review-client")).toBeVisible();
    await expect(canvas.queryByText("Failed to load usage statistics.")).toBeNull();
  },
};

// Keep the service unavailable through automatic refreshes until the explicit retry.
let chartUnavailable = true;

export const ChartUnavailable = {
  beforeEach: () => { chartUnavailable = true; },
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "GET /api/usage/stats": { body: usageFixture.routes["GET /api/usage/stream"].events[0] },
    "GET /api/usage/chart": () => chartUnavailable
      ? { status: 503, body: { error: "Chart temporarily unavailable" } }
      : usageFixture.routes["GET /api/usage/chart"],
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chart = within(canvas.getByRole("region", { name: "Token and cost trend" }));
    await expect(await chart.findByRole("alert")).toHaveTextContent("Unable to load usage chart.");
    await expect(chart.queryByText("No data for this period")).toBeNull();
    chartUnavailable = false;
    await userEvent.click(chart.getByRole("button", { name: "Retry chart", exact: true }));
    await expect(await chart.findByLabelText("Usage totals per interval")).toHaveTextContent("2.4K tokens, $0.1500");
    await expect(chart.getByLabelText("Usage totals per interval")).toHaveTextContent("3.6K tokens, $0.2300");
    await expect(chart.queryByRole("alert")).toBeNull();
  },
};

let keyLimitsAttempts = 0;

export const KeyLimitsUnavailable = {
  beforeEach: () => { keyLimitsAttempts = 0; },
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "GET /api/keys/usage": () => ++keyLimitsAttempts === 1
      ? { status: 503, body: { error: "Key usage temporarily unavailable" } }
      : usageFixture.routes["GET /api/keys/usage"],
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const keys = within(canvas.getByRole("region", { name: "API key limits" }));
    await expect(await keys.findByRole("alert")).toHaveTextContent("Unable to load API key limits.");
    await expect(keys.queryByText("No limits set. Edit them on the Keys page.")).toBeNull();
    await userEvent.click(keys.getByRole("button", { name: "Retry key limits", exact: true }));
    const rpm = await keys.findByRole("row", { name: /Requests \/ minute/ });
    await expect(rpm).toHaveTextContent("2 / 30");
    await expect(rpm).toHaveTextContent("28");
    await expect(await keys.findByRole("row", { name: /Tokens \/ day/ })).toHaveTextContent("6,000 / 100,000");
    await expect(keys.queryByRole("alert")).toBeNull();
  },
};

export const LoadingKeyLimits = {
  parameters: { storyFixture: { ...usageFixture, routes: {
    ...usageFixture.routes,
    "GET /api/keys/usage": () => new Promise(() => {}),
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const keys = within(canvas.getByRole("region", { name: "API key limits" }));
    await expect(await keys.findByRole("status")).toHaveTextContent("Loading API key limits…");
    await expect(keys.queryByText("No limits set. Edit them on the Keys page.")).toBeNull();
    await expect(await canvas.findByText("Total requests")).toBeVisible();
  },
};
