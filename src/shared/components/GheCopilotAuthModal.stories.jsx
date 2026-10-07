import React from "react";
import { expect, userEvent, within } from "storybook/test";
import GheCopilotAuthModal from "./GheCopilotAuthModal";

const fixture = (routes = {}) => ({ storyFixture: { scenario: "default", pathname: "/dashboard/providers", routes } });
const args = { isOpen: true, providerInfo: { name: "GitHub Enterprise" }, onClose: () => {}, onSuccess: () => {}, proxyPoolsReady: true };
export default { title: "Production/shared-auth/GheCopilotAuthModal", component: GheCopilotAuthModal };

export const InvalidOrigin = {
  args,
  parameters: fixture(),
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Connect GitHub Enterprise Copilot" });
    await userEvent.type(within(dialog).getByLabelText("GitHub Enterprise URL"), "http://insecure.example.test");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByText(/Enter an https URL/i)).toBeVisible();
  },
};

export const DeviceCodeHandoff = {
  args,
  parameters: fixture({ "POST /api/oauth/ghe-copilot/device-code": { body: { user_code: "GHE-1234", verification_uri: "https://ghe.example.test/login/device", verification_uri_complete: "https://ghe.example.test/login/device?code=GHE-1234", interval: 5, expires_in: 600, flowId: "ghe-flow" } }, "POST /api/oauth/ghe-copilot/poll": { body: { success: true } }, "POST /api/oauth/ghe-copilot/cancel": { body: { ok: true } } }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog", { name: "Connect GitHub Enterprise Copilot" });
    await userEvent.type(within(dialog).getByLabelText("GitHub Enterprise URL"), "https://ghe.example.test/path");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await body.findByText("GHE-1234")).toBeVisible();
  },
};
