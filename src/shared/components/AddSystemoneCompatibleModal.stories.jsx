import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
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
    await userEvent.type(within(dialog).getByLabelText("API Key (optional)"), "redacted");
    await userEvent.click(within(dialog).getByRole("button", { name: /check/i }));
    await waitFor(() => expect(within(dialog).getByText("Save node, reopen Edit, then register discovered model IDs.")).toBeVisible());
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

export const EditAndRegister = {
  args: { isOpen: true, ...callbacks, node: { id: "systemone-review", name: "Review System One", prefix: "review-systemone", baseUrl: "http://localhost:3000/v1" } },
  parameters: fixture({
    "POST /api/provider-nodes/validate": { body: { valid: true, models: [{ id: "systemone-embed", name: "System One Embed" }] } },
    "POST /api/models/custom": { body: { ok: true } },
  }),
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Custom System One" });
    await userEvent.click(within(dialog).getByRole("button", { name: /check/i }));
    const model = await within(dialog).findByRole("button", { name: "System One Embed" });
    await waitFor(() => expect(model).toBeVisible());
    await userEvent.click(model);
    await expect(await within(dialog).findByRole("status")).toHaveTextContent("Registered systemone-embed");
    await expect(within(dialog).queryByRole("button", { name: "System One Embed" })).not.toBeInTheDocument();
  },
};
