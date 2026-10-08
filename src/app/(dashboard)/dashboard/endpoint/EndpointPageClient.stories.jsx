import React from "react";
import { expect, userEvent, within } from "storybook/test";

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

let pendingSettings;
let finishPendingSettings;

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

// Keep the real parent in its pending phase through final capture; release the
// deferred request only when navigation disposes this story.
export const Loading = {
  beforeEach: () => {
    pendingSettings = new Promise((resolve) => { finishPendingSettings = resolve; });
    return () => {
      finishPendingSettings({ body: safeSettings });
      pendingSettings = undefined;
      finishPendingSettings = undefined;
    };
  },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      routes: { ...safeRoutes, "GET /api/settings": () => pendingSettings },
    },
  },
  play: async ({ canvasElement }) => {
    const skeleton = canvasElement.querySelector('[aria-hidden="true"]');
    await expect(skeleton).toBeVisible();
    await expect(skeleton.getBoundingClientRect().height).toBeGreaterThan(0);
    await expect(within(canvasElement).queryByRole("switch", { name: "Require API key" })).not.toBeInTheDocument();
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

export const ExternalEndpoints = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: {
        ...safeRoutes,
        "GET /api/tunnel/status": {
          body: {
            tunnel: {
              enabled: false,
              tunnelUrl: "",
              publicUrl: "",
              allUrls: [],
              externalTunnel: { tunnelUrl: "https://tunnel.example.com" },
            },
            tailscale: {
              enabled: false,
              tunnelUrl: "",
              systemTailscale: { tunnelUrl: "https://tailscale.example.com" },
            },
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByLabelText("External tunnel URL")).toHaveTextContent("https://tunnel.example.com/v1");
    await expect(await canvas.findByLabelText("External Tailscale URL")).toHaveTextContent("https://tailscale.example.com/v1");
  },
};

export const EnabledEndpointsPolicy = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: {
        ...safeRoutes,
        "GET /api/settings": { body: { ...safeSettings, tunnelDashboardAccess: false } },
        "GET /api/tunnel/status": {
          body: {
            tunnel: { enabled: true, tunnelUrl: "https://tunnel.example.com", publicUrl: "", allUrls: [] },
            tailscale: { enabled: false, tunnelUrl: "" },
          },
        },
        "PATCH /api/settings": { body: { success: true } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dashboardAccess = await canvas.findByRole("switch", { name: "Allow dashboard access via tunnel" });
    await expect(dashboardAccess).not.toBeChecked();
    await userEvent.click(dashboardAccess);
    await expect(dashboardAccess).toBeChecked();
  },
};

export const EnabledEndpointsChecking = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: {
        ...safeRoutes,
        "GET /api/tunnel/status": {
          body: {
            tunnel: { enabled: true, tunnelUrl: "https://tunnel.example.com", publicUrl: "", allUrls: ["https://tunnel.example.com", "https://backup.example.com"] },
            tailscale: { enabled: true, tunnelUrl: "https://tailscale.example.com" },
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Tunnel checking...")).toBeVisible();
    await expect(await canvas.findByText("Tailscale checking...")).toBeVisible();
    await expect(await canvas.findByText("All Cloudflare endpoints")).toBeVisible();
    await expect(await canvas.findByRole("button", { name: "More information" })).toBeVisible();
  },
};

export const TunnelRequiresApiKey = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: {
        ...safeRoutes,
        "GET /api/settings": { body: { ...safeSettings, requireApiKey: false } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tunnelRow = canvas.getByText("Tunnel").parentElement;
    await userEvent.click(within(tunnelRow).getByRole("button", { name: "Enable" }));
    await expect(await canvas.findByText('Security required: Enable "Require API key" before activating the tunnel.')).toBeVisible();
  },
};
