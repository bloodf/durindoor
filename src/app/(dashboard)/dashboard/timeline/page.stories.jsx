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

const defaultRoutes = {
  "GET /api/timeline": { body: { traces: [trace], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } } },
  "GET /api/settings": { body: { enableProxyTimeline: true } },
  "GET /api/timeline/stream": { body: {}, events: [{ traceId: trace.id }] },
};

export default {
  title: "Production/timeline/TimelinePage",
  component: TimelinePage,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/timeline", params: {}, routes: defaultRoutes } },
};

// Loaded covers private TimelineSkeleton completion, status badges, provider logo cells, and DataTable rows.
export const Loaded = {};
export const LiveUpdates = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("switch", { name: "Live timeline updates" }));
    await canvas.findByText("Listening for updates");
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
      pathname: "/dashboard/timeline?pageSize=all&page=1",
      params: {},
      routes: {
        "GET /api/timeline": (request) => {
          const url = new URL(request.url, "http://storybook.local");
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
