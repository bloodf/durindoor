import React from "react";
import { expect, within } from "storybook/test";

import EndpointPageClient from "./EndpointPageClient";

const safeSettings = {
  requireApiKey: true,
  requireLogin: true,
  hasPassword: true,
  tunnelDashboardAccess: false,
};

const safeRoutes = {
  "GET /api/monitoring": { body: { runtime: { activeRequests: 2, memoryRssMB: 146, processUptimeSec: 3600 }, health: [{ id: "openai", name: "OpenAI", requests: 100, errors: 1, successRate: 99 }], activity: { recent: [{ provider: "openai", model: "gpt-4o", status: 200, timestamp: "2026-10-09T12:00:00Z" }] } } },
  "GET /api/settings": { body: safeSettings },
  "GET /api/tunnel/status": {
    body: {
      tunnel: { enabled: false, tunnelUrl: "", publicUrl: "", allUrls: [] },
      tailscale: { enabled: false, tunnelUrl: "" },
    },
  },
};

const meta = {
  title: "Durin DS/Production Pages/Endpoint",
  component: EndpointPageClient,
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: safeRoutes,
    },
  },
  args: { localPort: 20128 },
};

export default meta;

export const Default = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("146 MB")).toBeVisible();
    await expect(canvas.queryByText(/Unexpected Storybook network request/)).not.toBeInTheDocument();
  },
};

export const ApiKeyRequired = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("switch", { name: "Require API key" })).toBeChecked();
    await expect(await canvas.findByText("http://localhost:20128/v1")).toBeVisible();
  },
};

export const UnsafeTunnel = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: {
        ...safeRoutes,
        "GET /api/settings": {
          body: { ...safeSettings, requireApiKey: false, requireLogin: false, hasPassword: false },
        },
      },
    },
  },
};
