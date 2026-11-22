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
export const Loaded = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "MITM Proxy" })).toBeVisible();
    await expect(await canvas.findByText("MITM Server")).toBeVisible();
  },
};
export const TrustPrompts = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/mitm", routes: { ...routes, "GET /api/cli-tools/antigravity-mitm": { body: { running: false, certExists: true, certTrusted: false, dnsStatus: {}, hasCachedPassword: false, needsSudoPassword: true, isWin: false } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Trust Cert" }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.contains(canvasElement.ownerDocument.activeElement)).toBe(true);
  },
};
export const AntigravityExpanded = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByText("Antigravity"));
    await expect(await canvas.findByText(/Enable DNS to edit model mappings/i)).toBeInTheDocument();
  },
};
