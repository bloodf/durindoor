import React from "react";
import { expect, userEvent, within } from "storybook/test";

import APIPageClient from "./EndpointPageClient";

/**
 * Private widget scenario coverage map
 * -----------------------------------
 *   CardSkeleton       -> Loading (pending /api/keys keeps endpoint fetch busy).
 *   EndpointRow        -> Default (Local), EmptyKeys, TunnelHealthy, TunnelUnreachable,
 *                          TunnelEnabledExternal, PauseConfirmation
 *                          (key row copy button uses EndpointRow pattern).
 *   StatusAlert        -> TunnelError, TailscaleInstalled (status banner), PauseConfirmation
 *                          (modal body error tone).
 *   SecurityWarning    -> LoginUnsafe, RemoteHostNoKey.
 *   Tooltip            -> TunnelHealthy (dashboard-access toggle help icon).
 *   ApiKeyPolicyFields -> CatalogLoading, UsageLimitReached (separate widget stories).
 *   ApiKeyRow          -> Default, PauseConfirmation, KeyMixWithResume (Toggle + actions).
 *   ConfirmDialog      -> PauseConfirmation, KeyMixWithResume resume asserts no dialog.
 */

const baseKey = {
  id: "key-production",
  name: "Production key",
  maskedKey: "dd_live_••••••••••••••••",
  isActive: true,
  createdAt: "2026-09-01T10:00:00.000Z",
  expiresAt: "2026-12-31T00:00:00.000Z",
  allowedCombos: ["balanced"],
  dailyLimitTokens: 500000,
  providerConnectionIds: ["provider-openai"],
  policy: { accessMode: "selected", allowedModels: ["gpt-5"], maxTokens: "1000000", maxCostUsd: "25" },
  usage: { totalTokens: 12000, totalCost: 1.25, totalRequests: 42 },
};

const pausedKey = {
  ...baseKey,
  id: "key-paused",
  name: "Legacy key",
  isActive: false,
};

const providerConnections = [
  { id: "provider-openai", name: "Primary OpenAI", provider: "openai" },
  { id: "provider-anthropic", name: "Claude fallback", provider: "anthropic" },
];

const safeSettings = { requireApiKey: true, requireLogin: true, hasPassword: true, tunnelDashboardAccess: false };
const unsafeSettings = { requireApiKey: false, requireLogin: false, hasPassword: false, tunnelDashboardAccess: false };

const safeRoutes = {
  "GET /api/keys": { body: { keys: [baseKey], providerConnections } },
  "GET /api/combos": { body: { combos: [{ id: "balanced", name: "balanced", kind: "fallback" }] } },
  "GET /api/keys/policy-catalog": {
    body: { models: [{ id: "gpt-5", displayId: "gpt-5", name: "GPT-5", provider: "openai" }] },
  },
  "GET /api/settings": { body: safeSettings },
  "GET /api/tunnel/status": {
    body: {
      tunnel: { enabled: false, tunnelUrl: "", publicUrl: "", allUrls: [] },
      tailscale: { enabled: false, tunnelUrl: "" },
    },
  },
};

const unsafeRoutes = { ...safeRoutes, "GET /api/settings": { body: unsafeSettings } };

const tunnelErrorRoutes = {
  ...safeRoutes,
  "GET /api/tunnel/status": {
    body: {
      tunnel: { enabled: false, tunnelUrl: "", publicUrl: "", allUrls: [], error: "quota exceeded" },
      tailscale: { enabled: false, tunnelUrl: "" },
    },
  },
};

// Keep the parent page's initial Promise.all pending so its private CardSkeleton
// remains visible instead of flashing past before Storybook captures it.
const pendingEndpointRoutes = {
  ...safeRoutes,
  "GET /api/keys": async () => new Promise(() => {}),
};

const externalTunnelRoutes = {
  ...safeRoutes,
  "GET /api/tunnel/status": {
    body: {
      tunnel: {
        enabled: false,
        tunnelUrl: "https://example.trycloudflare.com",
        publicUrl: "https://example.trycloudflare.com",
        allUrls: ["https://example.trycloudflare.com", "https://example-direct.trycloudflare.com"],
        externalTunnel: { tunnelUrl: "https://external.trycloudflare.com" },
      },
      tailscale: { enabled: false, tunnelUrl: "" },
    },
  },
};

const healthyTunnelRoutes = {
  ...safeRoutes,
  "GET /api/tunnel/status": {
    body: {
      tunnel: {
        enabled: true,
        tunnelUrl: "https://healthy.trycloudflare.com",
        publicUrl: "https://healthy-direct.trycloudflare.com",
        allUrls: ["https://healthy.trycloudflare.com"],
      },
      tailscale: { enabled: false, tunnelUrl: "" },
    },
  },
};
const healthyTunnelExternalFixtures = {
  "GET https://healthy-direct.trycloudflare.com/api/health": { body: { ok: true } },
  "GET https://healthy.trycloudflare.com/api/health": { body: { ok: true } },
};
const unreachableTunnelExternalFixtures = {
  "GET https://flaky.trycloudflare.com/api/health": { status: 503, body: { error: "unreachable" } },
};

const unreachableTunnelRoutes = {
  ...safeRoutes,
  "GET /api/tunnel/status": {
    body: {
      tunnel: {
        enabled: true,
        tunnelUrl: "https://flaky.trycloudflare.com",
        publicUrl: "",
        allUrls: ["https://flaky.trycloudflare.com"],
      },
      tailscale: { enabled: false, tunnelUrl: "" },
    },
  },
};

const keyMixRoutes = {
  ...safeRoutes,
  "GET /api/keys": { body: { keys: [pausedKey, baseKey], providerConnections } },
  "PUT /api/keys/key-paused": {
    body: { id: "key-paused", name: "Legacy key", isActive: true, maskedKey: "dd_live_•••" },
  },
};

const meta = {
  title: "Durin DS/Production Pages/Endpoint & Key",
  component: APIPageClient,
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: safeRoutes,
    },
  },
  args: { machineId: "story-machine", localPort: 20128 },
};

export default meta;

/** Loaded real endpoint surface: local endpoint, key policy metadata, and remote exposure controls. */
export const Default = {};

/** Pending endpoint data keeps the private loading skeleton mounted. */
export const Loading = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: pendingEndpointRoutes,
    },
  },
  play: async ({ canvasElement }) => {
    const skeletons = canvasElement.querySelectorAll('[aria-hidden="true"]');
    await expect(skeletons).toHaveLength(2);
    await expect(skeletons[0]).toBeVisible();
  },
};

/** Empty-key state covers real EmptyState create action and full creation dialog. */
export const EmptyKeys = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: {
        ...safeRoutes,
        "GET /api/keys": { body: { keys: [], providerConnections } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const create = await canvas.findByRole("button", { name: "Create Key" });
    await userEvent.click(create);
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Create API Key" });
    await expect(dialog).toBeVisible();
  },
};

/** Existing-key interaction exposes pause confirmation before destructive disable action. */
export const PauseConfirmation = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pause = await canvas.findByRole("switch", { name: "Pause Production key" });
    await userEvent.click(pause);
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Pause API Key" });
    await expect(dialog).toBeVisible();
  },
};

/** Login-unsafe pre-enable banner surfaces the SecurityWarning component. */
export const LoginUnsafe = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/endpoint", params: {}, routes: unsafeRoutes },
  },
};

/** Remote host with no API key exposes the second SecurityWarning variant inside the keys card. */
export const RemoteHostNoKey = {
  args: { machineId: "story-machine-remote" },
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: { ...unsafeRoutes, "GET /api/keys": { body: { keys: [pausedKey], providerConnections } } },
    },
  },
};

/** Tunnel error path renders the StatusAlert danger variant inline in the tunnel row. */
export const TunnelError = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/endpoint", params: {}, routes: tunnelErrorRoutes },
  },
};

/** External Cloudflare tunnel surfaces the EndpointRow and StatusAlert external branch. */
export const TunnelEnabledExternal = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/endpoint", params: {}, routes: externalTunnelRoutes },
  },
};

/** Healthy local tunnel shows the real URL, copy button, and disable control. */
export const TunnelHealthy = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: healthyTunnelRoutes,
      externalFixtures: healthyTunnelExternalFixtures,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const url = await canvas.findByLabelText("Cloudflare tunnel URL");
    await expect(url).toHaveValue("https://healthy.trycloudflare.com/v1");
    await expect(await canvas.findByRole("button", { name: "Copy Cloudflare tunnel URL" })).toBeVisible();
    await expect(await canvas.findByRole("button", { name: "Disable Cloudflare tunnel" })).toBeVisible();
  },
};

/** Enabled-but-unreachable tunnel renders the reconnecting pill plus disable control. */
export const TunnelUnreachable = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/endpoint",
      params: {},
      routes: unreachableTunnelRoutes,
      externalFixtures: unreachableTunnelExternalFixtures,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Tunnel checking...")).toBeVisible();
    await expect(await canvas.findByRole("button", { name: "Disable Cloudflare tunnel" })).toBeVisible();
  },
};

/** Disabled (or never enabled) tunnel renders the Enable action. */
export const TunnelDisabled = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/endpoint", params: {}, routes: safeRoutes },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tunnelRow = (await canvas.findByText("Tunnel")).closest("div.flex");
    await expect(await within(tunnelRow).findByRole("button", { name: "Enable" })).toBeVisible();
  },
};

/** Two keys (paused + active) exercise the full ApiKeyRow mix and resume PUT path. */
export const KeyMixWithResume = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/endpoint", params: {}, routes: keyMixRoutes },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const resume = await canvas.findByRole("switch", { name: "Resume Legacy key" });
    await userEvent.click(resume);
    await expect(canvas.queryByRole("dialog", { name: "Pause API Key" })).toBeNull();
    await expect(resume).toBeChecked();
  },
};
