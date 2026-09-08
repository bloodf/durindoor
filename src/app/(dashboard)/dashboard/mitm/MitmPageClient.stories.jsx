import React from "react";
import { expect, userEvent, within } from "storybook/test";
import MitmPageClient from "./MitmPageClient";

const routes = {
  "GET /api/providers": { body: { connections: [] } },
  "GET /api/keys": { body: { keys: [] } },
  "GET /api/models/alias": { body: { aliases: {} } },
  "GET /api/settings": { body: { cloudEnabled: false } },
  "GET /api/cli-tools/antigravity-mitm": { body: { running: false, certExists: false, dnsStatus: {}, hasCachedPassword: false, needsSudoPassword: true, isWin: false } },
  "GET /api/cli-tools/antigravity-mitm/alias": { body: { aliases: {} } },
};

export default {
  title: "Production/operations/MitmPageClient",
  component: MitmPageClient,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/mitm", routes } },
};

export const Default = {};
export const AntigravityExpanded = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByText("Antigravity"));
    await expect(await canvas.findByText(/Enable DNS to edit model mappings/i)).toBeInTheDocument();
  },
};
