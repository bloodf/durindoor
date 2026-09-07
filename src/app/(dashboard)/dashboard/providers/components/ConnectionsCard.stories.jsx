import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import ConnectionsCard from "./ConnectionsCard";

const COOLDOWN_EPOCH_MS = Date.parse("2099-06-01T00:00:00.000Z");
const COOLDOWN_UNTIL_ISO = "2099-06-01T00:05:00.000Z";
let cooldownNowMs = COOLDOWN_EPOCH_MS;

const cooldownConnection = {
  id: "openai-cooldown",
  provider: "openai",
  authType: "apikey",
  name: "Cooling down",
  isActive: true,
  testStatus: "unavailable",
  priority: 1,
  "modelLock_gpt-5": COOLDOWN_UNTIL_ISO,
  providerSpecificData: {},
};

const routes = {
  "GET /api/providers": {
    body: {
      connections: [
        { id: "openai-main", provider: "openai", authType: "apikey", name: "Production", isActive: true, testStatus: "active", priority: 1, providerSpecificData: {} },
        { id: "openai-backup", provider: "openai", authType: "apikey", name: "Backup", isActive: false, testStatus: "error", priority: 2, lastError: "Invalid key", providerSpecificData: {} },
      ],
    },
  },
  "GET /api/proxy-pools": { body: { proxyPools: [{ id: "pool-a", name: "EU Pool", isActive: true, proxyUrl: "https://proxy.example.test" }] } },
  "GET /api/settings": { body: { providerStrategies: {} } },
  "PUT /api/providers/openai-main": { body: { connection: { id: "openai-main", provider: "openai", authType: "apikey", name: "Production", isActive: false, testStatus: "active", priority: 1, providerSpecificData: {} } } },
};

const cooldownRoutes = {
  ...routes,
  "GET /api/providers": { body: { connections: [cooldownConnection] } },
};

const meta = {
  title: "Production/providers/components/ConnectionsCard",
  component: ConnectionsCard,
  parameters: {
    layout: "padded",
    storyFixture: { scenario: "default", pathname: "/dashboard/media-providers/embedding/openai", params: {}, routes },
  },
};

export default meta;

/** Parent scenario covers ConnectionRow, cooldown/error/action states, proxy selector, reorder, round-robin controls, and the private AddApiKeyModal. */
export const Connected = {
  args: { providerId: "openai", isOAuth: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const productionConnection = (await canvas.findByText("Production")).closest("div.group");
    await expect(productionConnection).not.toBeNull();
    const productionScope = within(productionConnection);
    await userEvent.click(productionScope.getByRole("button", { name: /proxy/i }));
    await expect(await productionScope.findByText("EU Pool")).toBeInTheDocument();

    // Private AddApiKeyModal only renders once opened via the real "Add" trigger.
    await userEvent.click(await canvas.findByRole("button", { name: /^add$/i }));
    const body = within(document.body);
    const dialog = await waitFor(() => {
      const node = body.getByRole("dialog", { name: /add openai api key/i });
      expect(node).toBeVisible();
      return node;
    });
    await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect?.getTiming?.().iterations)).map(({ finished }) => finished.catch(() => {})));
    const dialogScope = within(dialog);
    await expect(dialogScope.getByText("Name")).toBeVisible();
    await expect(dialogScope.getByText("API Key")).toBeVisible();
    await expect(dialogScope.getByRole("button", { name: /^save$/i })).toBeDisabled();
    await userEvent.click(dialogScope.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  },
};

/** Parent scenario reaches ConnectionsCard's private CooldownTimer with a fixed clock and proves expiry unmounts it. */
export const Cooldown = {
  parameters: {
    storyFixture: { scenario: "default", pathname: "/dashboard/media-providers/embedding/openai", params: {}, routes: cooldownRoutes },
  },
  args: { providerId: "openai", isOAuth: false },
  beforeEach: async () => {
    const originalNow = Date.now;
    cooldownNowMs = COOLDOWN_EPOCH_MS;
    Date.now = () => cooldownNowMs;
    return () => {
      Date.now = originalNow;
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Cooling down")).toBeVisible();
    const countdown = await canvas.findByText(/⏱\s+5m\s+0s/);
    await expect(countdown).toBeVisible();

    cooldownNowMs = Date.parse(COOLDOWN_UNTIL_ISO) + 1000;
    await waitFor(() => {
      expect(countdown).not.toBeInTheDocument();
      expect(canvas.getByText("active", { exact: true })).toBeVisible();
    }, { timeout: 2500 });
  },
};
