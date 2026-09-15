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
