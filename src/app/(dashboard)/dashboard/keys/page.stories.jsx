import React from "react";
import { expect, within } from "storybook/test";
import KeysPage from "./page";

export default {
  title: "Production/keys/KeysPage",
  component: KeysPage,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/keys", routes: { "GET /api/keys": { body: { keys: [], providerConnections: [] } }, "GET /api/keys/usage": { body: { usage: {} } }, "GET /api/combos": { body: { combos: [] } }, "GET /api/keys/policy-catalog": { body: { models: [] } } } } },
};

export const Empty = {
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("button", { name: "Create Key" })).toBeVisible();
  },
};
