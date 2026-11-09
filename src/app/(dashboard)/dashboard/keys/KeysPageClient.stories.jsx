import React from "react";
import { expect, userEvent, within } from "storybook/test";

import KeysPageClient from "./KeysPageClient";

const key = {
  id: "key-production",
  name: "Production key",
  maskedKey: "dd_live_••••••••",
  isActive: true,
  createdAt: "2026-09-01T10:00:00.000Z",
  expiresAt: null,
  allowedCombos: [],
  dailyLimitTokens: null,
  providerConnectionIds: [],
  policy: { allowedModels: [] },
  usage: { totalTokens: 0, totalCost: 0, totalRequests: 0 },
};

const routes = {
  "GET /api/keys": { body: { keys: [key], providerConnections: [] } },
  "GET /api/keys/usage": { body: { usage: {} } },
  "GET /api/combos": { body: { combos: [] } },
  "GET /api/keys/policy-catalog": { body: { models: [] } },
};

const meta = {
  title: "Durin DS/Production Pages/API Keys",
  component: KeysPageClient,
  parameters: {
    layout: "padded",
    storyFixture: { scenario: "default", pathname: "/dashboard/keys", params: {}, routes },
  },
};

export default meta;

export const Default = {};

export const Empty = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/keys",
      params: {},
      routes: { ...routes, "GET /api/keys": { body: { keys: [], providerConnections: [] } } },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const create = await canvas.findByRole("button", { name: "Create Key" });
    await userEvent.click(create);
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Create API Key" }),
    ).toBeVisible();
  },
};

export const KeyLimits = {
  parameters: {
    storyFixture: {
      scenario: "default", pathname: "/dashboard/keys", params: {},
      routes: { ...routes, "GET /api/keys/usage": { body: { usage: { [key.id]: { rpm: { used: 5, limit: 20 }, limits: [] } } } } },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("API key limits")).toBeVisible();
    await expect(await canvas.findByText("Requests / minute")).toBeVisible();
    await expect(canvas.getByText("15")).toBeVisible();
  },
};

export const RevocationRejectedAndRetry = {
  parameters: { storyFixture: (() => {
    let removed = false;
    let attempts = 0;
    return { scenario: "default", pathname: "/dashboard/keys", reset: () => { removed = false; attempts = 0; }, routes: { ...routes,
      "GET /api/keys": () => ({ body: { keys: removed ? [] : [key], providerConnections: [] } }),
      "DELETE /api/keys/key-production": () => { if (++attempts === 1) return { status: 503, body: { error: "Revocation rejected" } }; removed = true; return { body: { ok: true } }; },
    } };
  })() },
  beforeEach: ({ parameters }) => { parameters.storyFixture.reset(); },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Delete Production key" }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole("dialog", { name: "Delete API Key" }));
    await userEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    await expect(await dialog.findByRole("alert")).toHaveTextContent("Revocation rejected");
    await expect(canvas.getByText("Production key", { selector: "p" })).toBeVisible();
    await userEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    await expect(canvas.queryByText("Production key", { selector: "p" })).not.toBeInTheDocument();
  },
};

export const RevocationPending = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/keys", routes: { ...routes,
    "DELETE /api/keys/key-production": () => new Promise(() => {}),
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Delete Production key" }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Delete API Key" }));
    await userEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    await expect(dialog.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(canvas.getByText("Production key", { selector: "p" })).toBeVisible();
  },
};
