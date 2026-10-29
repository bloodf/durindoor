import React from "react";
import { expect, userEvent, within } from "storybook/test";
import OrcaRouterAuthModal from "./OrcaRouterAuthModal";

const fixture = (routes) => ({ storyFixture: { scenario: "default", pathname: "/dashboard/providers", routes: { "GET /api/providers": { body: { connections: [] } }, ...routes } } });
const args = { isOpen: true, providerInfo: { name: "OrcaRouter" }, onClose: () => {}, onSuccess: () => {} };
export default { title: "Production/shared-auth/OrcaRouterAuthModal", component: OrcaRouterAuthModal };

export const OAuthCodeFlow = {
  args,
  parameters: fixture({
    "GET /api/oauth/orcarouter/authorize?redirect_uri=oob": { body: { authUrl: "https://auth.example.test/orca?state=story", flowId: "orca-flow", state: "story" } },
    "POST /api/oauth/orcarouter/exchange": { body: { success: true } },
  }),
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Connect OrcaRouter" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Sign in with OrcaRouter" }));
    const code = await within(dialog).findByLabelText("Authorization code");
    await userEvent.type(code, "story-code");
    await userEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    expect(await within(dialog).findByText("Connected. You can close this window.")).toBeVisible();
  },
};

export const ApiKeyFailure = {
  args,
  parameters: fixture({ "POST /api/providers": { status: 500, body: { error: "Key storage unavailable" } } }),
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Connect OrcaRouter" });
    await userEvent.click(within(dialog).getByRole("button", { name: "OrcaRouter - API" }));
    await userEvent.type(within(dialog).getByLabelText("OrcaRouter API key"), "sk-orca-invalid");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save API key" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Key storage unavailable");
  },
};
