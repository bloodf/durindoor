import React from "react";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";
import GheCopilotAuthModal from "./GheCopilotAuthModal";

const fixture = (routes = {}) => ({ storyFixture: { scenario: "default", pathname: "/dashboard/providers", routes } });
const args = { isOpen: true, providerInfo: { name: "GitHub Enterprise" }, onClose: () => {}, onSuccess: () => {}, proxyPoolsReady: true };
export default { title: "Production/shared-auth/GheCopilotAuthModal", component: GheCopilotAuthModal };

function mockPopup() {
  const popup = { closed: false, close: fn() };
  const open = spyOn(window, "open").mockReturnValue(popup);
  return () => open.mockRestore();
}

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
  beforeEach: mockPopup,
  parameters: fixture({
    "POST /api/oauth/ghe-copilot/device-code": {
      body: {
        user_code: "GHE-1234",
        verification_uri: "https://ghe.example.test/login/device",
        verification_uri_complete: "https://ghe.example.test/login/device?code=GHE-1234",
        interval: 5,
        expires_in: 600,
        flowId: "ghe-flow"
      }
    },
    "POST /api/oauth/ghe-copilot/poll": {
      body: {
        success: false,
        error: "authorization_pending",
        errorDescription: "Authorization pending",
        pending: true
      }
    },
    "POST /api/oauth/ghe-copilot/cancel": { body: { ok: true } }
  }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const setupDialog = await body.findByRole("dialog", { name: "Connect GitHub Enterprise Copilot" });
    await userEvent.type(within(setupDialog).getByLabelText("GitHub Enterprise URL"), "https://ghe.example.test/path");
    await userEvent.click(within(setupDialog).getByRole("button", { name: "Continue" }));

    const dialog = await body.findByRole("dialog", { name: "Connect GitHub Enterprise" });
    await waitFor(() => expect(window.open).toHaveBeenCalledWith(
      "https://ghe.example.test/login/device?code=GHE-1234",
      "_blank",
      "noopener,noreferrer"
    ));
    // The device scene mounts before its modal entrance animation is visible.
    await waitFor(() => {
      expect(within(dialog).getByText("GHE-1234")).toBeVisible();
      expect(within(dialog).getByText("https://ghe.example.test/login/device?code=GHE-1234")).toBeVisible();
      expect(within(dialog).getByText("Waiting for authorization…")).toBeVisible();
      expect(within(dialog).getByRole("button", { name: "Copy login URL" })).toBeEnabled();
      expect(within(dialog).getByRole("button", { name: "Open login URL" })).toBeEnabled();
      expect(within(dialog).getByRole("button", { name: "Copy device code" })).toBeEnabled();
    });
  },
};
