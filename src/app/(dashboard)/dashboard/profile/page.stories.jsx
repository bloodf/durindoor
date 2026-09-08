import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import ProfilePage from "./page";

const settings = {
  fallbackStrategy: "fill-first",
  comboStrategy: "fallback",
  requireLogin: true,
  hasPassword: true,
  authMode: "password",
  exposeComboOnly: false,
  hidePaidModels: false,
  enableObservability: true,
  enableProxyTimeline: true,
  proxyTimelineRetentionDays: 7,
  visionBridgeModel: "openai/gpt-4o",
  visionBridgeEnabled: true,
  outboundProxyEnabled: false,
};

const selectiveCatalog = {
  providers: [{ id: "prov-1", name: "OpenAI" }],
  combos: [{ id: "combo-1", name: "Fast + Cheap" }],
};

const selectiveRoutes = {
  "POST /api/settings/database/selective": async (request) => {
    const payload = await request.json();
    if (payload.action === "catalog") return { body: selectiveCatalog };
    if (payload.action === "preview") {
      return {
        body: {
          providerConnections: (payload.selection?.providers ?? []).map((id) => ({ id, currentName: "OpenAI", action: "update" })),
          combos: (payload.selection?.combos ?? []).map((id) => ({ id, finalName: "Fast + Cheap", action: "update" })),
        },
      };
    }
    return { body: { ok: true } };
  },
};

const baseRoutes = {
  "GET /api/settings": { body: settings },
  "PATCH /api/settings": async (request) => ({ body: { ...settings, ...(await request.json()) } }),
  "GET /api/settings/database": { body: { exportDate: "2026-09-05T00:00:00Z", tables: [] } },
  "POST /api/auth/logout": { body: {} },
  "POST /api/version/shutdown": { body: {} },
  ...selectiveRoutes,
};

const meta = {
  title: "Production/profile/ProfilePage",
  component: ProfilePage,
  parameters: {
    layout: "fullscreen",
    storyFixture: { scenario: "default", pathname: "/dashboard/profile", routes: baseRoutes },
  },
};

export default meta;

export const Default = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Settings" })).toBeVisible();
    const toggle = canvas.getByRole("switch", { name: "Round Robin" });
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);
    await expect(await canvas.findByRole("spinbutton", { name: "Sticky Limit" })).toBeVisible();
  },
};

export const OidcAndProxy = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/profile",
      routes: {
        ...baseRoutes,
        "GET /api/settings": { body: { ...settings, authMode: "both", outboundProxyEnabled: true } },
        "POST /api/auth/oidc/test": { body: { ok: true, issuerUrl: "https://issuer.example.test" } },
        "POST /api/settings/proxy-test": { body: { ok: true, status: 204, elapsedMs: 8 } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Toggle OIDC settings" }));
    await expect(canvas.getByLabelText("Auth mode")).toBeVisible();
    await expect(canvas.getByLabelText("Proxy URL")).toBeVisible();
  },
};

export const ShutdownConfirm = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Shutdown" }));
    const dialog = await body.findByRole("dialog", { name: "Close Proxy" });
    await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished));
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
  },
};

export const DatabaseExportPrompt = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Download Backup" }));
    const dialog = await body.findByRole("dialog", { name: "Confirm Password" });
    await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished));
    const passwordInput = within(dialog).getByPlaceholderText("Current password");
    await expect(passwordInput).toBeVisible();
    await userEvent.type(passwordInput, "password123");
  },
};
export const SelectiveTransferPreview = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Load transfer catalog" }));
    await userEvent.type(await body.findByLabelText("Current password"), "password123");
    await userEvent.click(await body.findByRole("button", { name: "Continue" }));
    await userEvent.click(await canvas.findByLabelText("OpenAI"));
    await userEvent.click(canvas.getByRole("button", { name: "Preview" }));
    await userEvent.type(await body.findByLabelText("Current password"), "password123");
    await userEvent.click(await body.findByRole("button", { name: "Continue" }));
    await expect(await canvas.findByText("Export preview")).toBeVisible();
  },
};
