import React from "react";
import { expect, within } from "storybook/test";
import ApiKeyLimitsCard from "./ApiKeyLimitsCard";

const key = { id: "key-1", name: "Production key" };
const routes = {
  "GET /api/keys": { body: { keys: [key] } },
  "GET /api/keys/usage": { body: { usage: { "key-1": { rpm: { used: 19, limit: 20 }, tpm: { used: 1200, limit: 5000 }, limits: [] } } } },
};

export default {
  title: "Production/keys/ApiKeyLimitsCard",
  component: ApiKeyLimitsCard,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/keys", routes } },
};

export const ConfiguredLimits = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("API key limits")).toBeVisible();
    await expect(canvas.getByText("Requests / minute")).toBeVisible();
    await expect(canvas.getByRole("cell", { name: "19 / 20" })).toBeVisible();
  },
};

export const NoConfiguredLimits = {
  // Null clears meta-level objects during Storybook's recursive parameter merge.
  parameters: { storyFixture: { scenario: "empty", pathname: "/dashboard/keys", routes: { ...routes, "GET /api/keys/usage": { body: { usage: { "key-1": { rpm: null, tpm: null, limits: [] } } } } } } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No limits set. Edit them on the Keys page.")).toBeVisible();
  },
};
