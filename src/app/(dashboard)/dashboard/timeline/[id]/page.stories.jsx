import React from "react";
import { expect, userEvent, within } from "storybook/test";
import TimelineDetailPage from "./page";
import TimelineDetailSkeleton from "./TimelineDetailSkeleton.jsx";

const trace = {
  trace: { id: "trace-001", started_at: "2026-09-05T12:00:00.000Z", status: "ok", provider: "codex", model: "gpt-5", connection_id: "fixture-connection" },
  events: [
    { seq: 1, type: "request", direction: "out", summary: "POST /v1/chat/completions", payload: { model: "gpt-5" } },
    { seq: 2, type: "sse_chunk", direction: "in", summary: "open", payload: "event: message\ndata: {\"choices\":[{}]}" },
    { seq: 3, type: "sse_chunk", direction: "in", summary: "delta", payload: "event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}" },
    { seq: 4, type: "sse_chunk", direction: "in", summary: "delta", payload: "event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\" there\"}}]}" },
    { seq: 5, type: "response", direction: "in", summary: "200", payload: { status: 200 } },
  ],
};

const defaultRoutes = {
  "GET /api/timeline/trace-001": { body: trace },
};

const loadingRoutes = {
  "GET /api/timeline/loading": () => new Promise(() => {}),
};

export default {
  title: "Production/timeline/TimelineDetailPage",
  component: TimelineDetailPage,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/timeline/trace-001", params: { id: "trace-001" }, routes: defaultRoutes } },
};
export const Loaded = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("POST /v1/chat/completions")).toBeVisible();
    await expect(canvas.getByRole("region", { name: /Timeline event #1 details/ })).toHaveTextContent('"model": "gpt-5"');
  },
};
// Loaded covers singleton EventRow payloads; ExpandSseChunks covers the private EventGroup collapse lifecycle.

export const ExpandSseChunks = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const expand = await canvas.findByRole("button", { name: "3 chunks" });
    await userEvent.click(expand);
    await canvas.findByRole("button", { name: "Collapse 3 chunks" });
  },
};

export const CopyAsJson = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Copy as JSON" }));
    await expect(canvas.getByRole("button", { name: "Copied" })).toBeVisible();
  },
};

export const MissingTrace = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/timeline/missing",
      params: { id: "missing" },
      routes: { "GET /api/timeline/missing": { body: { error: "Not found" }, status: 404 } },
    },
  },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("alert");
  },
};

export const Loading = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/timeline/loading",
      params: { id: "loading" },
      routes: loadingRoutes,
    },
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  },
};

export const Skeleton = {
  render: () => <TimelineDetailSkeleton />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll(".animate-pulse")).toHaveLength(2);
  },
};
