import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import RequestLogger from "./RequestLogger.js";

const logs = [
  "2026-01-01 00:00:00 | gpt-4 | openai | acct-A | 12 | 34 | OK",
  "2026-01-01 00:00:01 | claude-3 | anthropic | acct-B | 8 | 22 | PENDING",
  "2026-01-01 00:00:02 | gemini | google | acct-C | 4 | 9 | FAILED",
];

let requestLogFetches = 0;
let pendingRequestLogPolls = [];

// One rejected fetch exercises the source's real console.error path. Later
// native refreshes stay pending so capture retains the error without re-logging.
function fetchErrorThenPending() {
  if (requestLogFetches++ === 0) return Promise.reject(new Error("Intentional RequestLogger fixture failure."));
  return new Promise((resolve) => { pendingRequestLogPolls.push(resolve); });
}

const meta = {
  title: "Production/shared-analytics/RequestLogger",
  component: RequestLogger,
  parameters: { layout: "padded" },
};
export default meta;

export const Populated = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/usage",
      params: {},
      routes: { "GET /api/usage/request-logs": { body: logs, status: 200 } },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText("gpt-4")).toBeVisible();
    });
    expect(canvas.getByText("PENDING")).toBeVisible();
  },
};

export const Empty = {
  parameters: {
    storyFixture: {
      scenario: "empty",
      pathname: "/dashboard/usage",
      params: {},
      routes: { "GET /api/usage/request-logs": { body: [], status: 200 } },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // RequestLogger delegates empty rendering to DataTable, whose built-in
    // EmptyState title is its public empty contract.
    await expect(await canvas.findByText("No data to display")).toBeVisible();
  },
};

export const FetchError = {
  beforeEach: () => {
    requestLogFetches = 0;
    pendingRequestLogPolls = [];
    return () => {
      for (const resolve of pendingRequestLogPolls) resolve({ body: logs, status: 200 });
      pendingRequestLogPolls = [];
      requestLogFetches = 0;
    };
  },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/usage",
      params: {},
      routes: { "GET /api/usage/request-logs": fetchErrorThenPending },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = await waitFor(() => canvas.getByRole("alert"));
    expect(alert).toHaveTextContent(/Failed to load request logs/i);
    expect(alert).toBeVisible();
    await waitFor(() => {
      expect(pendingRequestLogPolls.length).toBeGreaterThan(0);
    }, { timeout: 4000 });
    expect(canvas.getByRole("alert")).toHaveTextContent(/Failed to load request logs/i);
    expect(canvas.getByRole("alert")).toBeVisible();
  },
};

export const AutoRefreshControl = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/usage",
      params: {},
      routes: { "GET /api/usage/request-logs": { body: logs, status: 200 } },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await waitFor(() => canvas.getByRole("switch", { name: /auto refresh every 3 seconds/i }));
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });
  },
};
