import React from "react";
import { expect, userEvent, within } from "storybook/test";
import Component from "./BulkImportGrokCliModal";

export default { title: "Production/providers/BulkImportGrokCliModal", component: Component, args: { isOpen: true, onClose: () => {}, onSuccess: () => {} }, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: {} } } };
export const Open = { play: async () => { await expect(await within(document.body).findByRole("dialog", { name: "Bulk Add Grok CLI Accounts" })).toBeVisible(); } };
export const InvalidJson = { play: async () => { const dialog = within(await within(document.body).findByRole("dialog")); await userEvent.type(dialog.getByLabelText("Grok CLI accounts JSON"), "invalid"); await userEvent.click(dialog.getByRole("button", { name: "Import All" })); await expect(dialog.getByRole("alert")).toHaveTextContent("Invalid JSON"); } };

export const Pending = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: { "POST /api/oauth/grok-cli/bulk-import": () => new Promise(() => {}) } } },
  play: async () => { const dialog = within(await within(document.body).findByRole("dialog")); await userEvent.type(dialog.getByLabelText("Grok CLI accounts JSON"), '{{}'); await userEvent.click(dialog.getByRole("button", { name: "Import All" })); await expect(dialog.getByRole("button", { name: "Importing..." })).toBeDisabled(); },
};
