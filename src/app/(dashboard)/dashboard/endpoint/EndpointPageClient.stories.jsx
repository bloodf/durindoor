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

export const Default = {};

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
