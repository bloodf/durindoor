import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import VisibleModelsModal from "./VisibleModelsModal";

const args = { isOpen: true, onClose: () => {}, providerId: "openai", providerAlias: "openai", connections: [], customModels: [], disabledModelIds: [] };
export default { title: "Production/providers/VisibleModelsModal", component: VisibleModelsModal, args, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: { "GET /api/models/enabled?providerAlias=openai": { body: { ids: [] } } } } } };
export const Open = { play: async () => { await expect(await within(document.body).findByRole("dialog", { name: "Visible models" })).toBeVisible(); } };
export const LoadError = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: { "GET /api/models/enabled?providerAlias=openai": { status: 500, body: { error: "unavailable" } } } } },
  play: async () => { const dialog = await within(document.body).findByRole("dialog"); await waitFor(() => expect(within(dialog).getByRole("alert")).toBeVisible()); await expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled(); },
};
export const SavePending = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: { "GET /api/models/enabled?providerAlias=openai": { body: { ids: [] } }, "PUT /api/models/enabled": () => new Promise(() => {}) } } },
  play: async () => {
    const dialog = within(await within(document.body).findByRole("dialog"));
    await waitFor(() => expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled());
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  },
};
