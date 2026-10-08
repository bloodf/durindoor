import React from "react";
import { expect, userEvent, within } from "storybook/test";
import AddSystemoneCompatibleModal from "./AddSystemoneCompatibleModal";

const fixture = (routes) => ({ storyFixture: { scenario: "default", pathname: "/dashboard/media-providers", routes } });
const callbacks = { onClose: () => {}, onCreated: () => {}, onSaved: () => {} };
export default { title: "Production/shared-config/AddSystemoneCompatibleModal", component: AddSystemoneCompatibleModal };

export const AddAndDiscover = {
  args: { isOpen: true, ...callbacks },
  parameters: fixture({ "POST /api/provider-nodes/validate": { body: { valid: true, models: [{ id: "systemone-embed", name: "System One Embed" }] } } }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog", { name: "Add Custom System One" });
    await userEvent.type(within(dialog).getByLabelText("API Key"), "redacted");
    await userEvent.click(within(dialog).getByRole("button", { name: /check/i }));
    expect(await within(dialog).findByText("System One Embed")).toBeVisible();
  },
};

export const DiscoveryError = {
  args: { isOpen: true, ...callbacks },
  parameters: fixture({ "POST /api/provider-nodes/validate": { body: { valid: false, error: "Endpoint rejected credentials" } } }),
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Add Custom System One" });
    await userEvent.click(within(dialog).getByRole("button", { name: /check/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Endpoint rejected credentials");
  },
};
