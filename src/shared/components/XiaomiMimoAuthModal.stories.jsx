import React from "react";
import { expect, userEvent, within } from "storybook/test";
import XiaomiMimoAuthModal from "./XiaomiMimoAuthModal";

const fixture = (routes) => ({ storyFixture: { scenario: "default", pathname: "/dashboard/providers", routes } });
const base = { isOpen: true, onClose: () => {}, onSuccess: () => {} };

export default { title: "Production/shared-auth/XiaomiMimoAuthModal", component: XiaomiMimoAuthModal };

export const LocalCredentialsFound = {
  args: base,
  parameters: fixture({ "GET /api/oauth/xiaomi-mimo/auto-import": { body: { found: true, apiKey: "redacted", uid: "user-42", baseUrl: "https://api.example.test" } } }),
  play: async ({ canvasElement }) => expect(await within(canvasElement.ownerDocument.body).findByText("Xiaomi MiMo Desktop credentials found!")).toBeVisible(),
};

export const BrowserLoginClusterSelection = {
  args: base,
  parameters: fixture({ "GET /api/oauth/xiaomi-mimo/auto-import": { body: { found: false } } }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("button", { name: /choose cluster/i }));
    expect(body.getByRole("button", { name: /Europe.*Amsterdam/i })).toBeVisible();
  },
};

export const DetectionFallback = {
  args: base,
  parameters: fixture({ "GET /api/oauth/xiaomi-mimo/auto-import": { status: 500, body: { error: "Desktop unavailable" } } }),
  play: async ({ canvasElement }) => expect(await within(canvasElement.ownerDocument.body).findByText("No local Desktop credentials found")).toBeVisible(),
};
