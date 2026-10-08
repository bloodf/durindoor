import React from "react";
import { expect, userEvent, within } from "storybook/test";
import TimelinePage from "./page";
import TimelineSkeleton from "./TimelineSkeleton.jsx";

const trace = {
  id: "trace-001",
  started_at: "2026-09-05T12:00:00.000Z",
  status: "ok",
  provider: "codex",
  model: "gpt-5",
  connection_id: "fixture-connection",
  event_count: 12,
  fallback_count: 1,
  total_ms: 342,
};

// The swimlane only draws traces inside the requested window, so the fixture
// stamps traces relative to the request's own endDate.
function windowTraces(request) {
  const url = new URL(request.url, "http://storybook.example");
  const end = Date.parse(url.searchParams.get("endDate")) || Date.now();
  const ago = (ms) => new Date(end - ms).toISOString();
  return [
    { ...trace, started_at: ago(4 * 60_000) },
    { ...trace, id: "trace-002", status: "error", provider: "claude", model: "claude-sonnet-4-5", connection_id: "fixture-connection-b", event_count: 4, total_ms: 900, started_at: ago(2 * 60_000) },
    { ...trace, id: "trace-003", status: "running", model: "gpt-5-mini", event_count: 2, total_ms: null, started_at: ago(30_000) },
  ];
}

const defaultRoutes = {
  "GET /api/timeline": (request) => {
    const url = new URL(request.url, "http://storybook.example");
    if (url.searchParams.get("endDate")) {
      const traces = windowTraces(request);
      return { body: { traces, pagination: { page: 1, pageSize: 100, totalItems: traces.length, totalPages: 1 } } };
    }
    return { body: { traces: [trace], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } } };
  },
  "GET /api/timeline/trace-001/meta": (request) => ({
    body: { trace: { ...windowTraces(request)[0], event_count: 13 } },
  }),
  "GET /api/settings": { body: { enableProxyTimeline: true } },
  "GET /api/timeline/stream": { body: {}, events: [{ traceId: trace.id }] },
};

export default {
  title: "Production/timeline/TimelinePage",
  component: TimelinePage,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/timeline", params: {}, routes: defaultRoutes } },
};

// Loaded covers the default swimlane view: window controls, lanes, and status-coloured bars.
export const Loaded = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("group", { name: "Trace swimlanes by provider" })).toBeVisible();
    await expect(canvas.getByRole("radio", { name: "Timeline" })).toHaveAttribute("aria-checked", "true");
    await expect(canvas.getByRole("radio", { name: "15m" })).toHaveAttribute("aria-checked", "true");
    await expect(canvas.getAllByRole("button", { name: /events$/ })).toHaveLength(3);
  },
};
export const SelectBar = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = await canvas.findByRole("button", { name: /claude-sonnet-4-5 · error · 900 ms · 4 events/ });
    bar.focus();
    await userEvent.keyboard("{Enter}");
    await expect(globalThis.__STORYBOOK_NAV__.__current()).toBe("/dashboard/timeline/trace-002");
  },
};
export const ConnectionLanes = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/timeline?lane=connection_id&window=1h", params: {}, routes: defaultRoutes } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("group", { name: "Trace swimlanes by connection" })).toBeVisible();
    await expect(canvas.getByRole("radio", { name: "1h" })).toHaveAttribute("aria-checked", "true");
  },
};
// TableView covers private TimelineSkeleton completion, status badges, provider logo cells, and DataTable rows.
export const TableView = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("radio", { name: "Table" }));
    await expect(await canvas.findByText("gpt-5")).toBeVisible();
    await expect(globalThis.__STORYBOOK_NAV__.__current()).toBe("/dashboard/timeline?view=table");
  },
};
export const LiveUpdates = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("switch", { name: "Live timeline updates" }));
    await canvas.findByText("Listening for updates");
    await expect(await canvas.findByRole("button", { name: /gpt-5 · ok · 342 ms · 13 events/ })).toBeVisible();
  },
};
export const CaptureDisabled = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/timeline",
      params: {},
      routes: {
        "GET /api/timeline": { body: { traces: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 } } },
        "GET /api/settings": { body: { enableProxyTimeline: false } },
      },
    },
  },
};
export const AllRows = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/timeline?view=table&pageSize=all&page=1",
      params: {},
      routes: {
        "GET /api/timeline": (request) => {
          const url = new URL(request.url, "http://storybook.example");
          const pageSize = url.searchParams.get("pageSize");
          const page = url.searchParams.get("page");
          const traces = pageSize === "100" && page === "1" ? [
            { id: "trace-001", started_at: "2026-09-05T12:00:00.000Z", status: "ok", provider: "codex", model: "gpt-5-mini", connection_id: "fixture-connection", event_count: 5, fallback_count: 0, total_ms: 100 },
            { id: "trace-002", started_at: "2026-09-05T12:00:00.000Z", status: "ok", provider: "codex", model: "gpt-5-pro", connection_id: "fixture-connection", event_count: 5, fallback_count: 0, total_ms: 100 },
          ] : pageSize === "100" && page === "2" ? [
            { id: "trace-003", started_at: "2026-09-05T12:00:00.000Z", status: "ok", provider: "codex", model: "gpt-5-turbo", connection_id: "fixture-connection", event_count: 5, fallback_count: 0, total_ms: 100 },
          ] : [];
          return { body: { traces, pagination: { page: Number(page) || 1, pageSize: Number(pageSize) || 20, totalItems: 3, totalPages: 1 } } };
        },
        "GET /api/settings": { body: { enableProxyTimeline: true } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("gpt-5-mini");
    await canvas.findByText("gpt-5-pro");
    await canvas.findByText("gpt-5-turbo");
  },
};
export const LoadError = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/timeline",
      params: {},
      routes: {
        "GET /api/timeline": { body: { error: "Unavailable" }, status: 500 },
        "GET /api/settings": { body: { enableProxyTimeline: true } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("alert");
  },
};

export const Loading = {
  render: () => <TimelineSkeleton />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll(".animate-pulse")).toHaveLength(2);
  },
};
