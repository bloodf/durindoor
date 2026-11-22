import React from "react";
import { expect, userEvent, within } from "storybook/test";
import ProviderErrorRulesModal from "./ProviderErrorRulesModal";
const args = { isOpen: true, providerId: "openai", rules: [], onSave: async () => {}, onClose: () => {} };
export default { title: "Production/providers/ProviderErrorRulesModal", component: ProviderErrorRulesModal, args, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: {} } } };
export const Open = { play: async () => { await expect(await within(document.body).findByRole("dialog", { name: "Provider Error Rules" })).toBeVisible(); } };
export const ValidationError = { play: async () => { const dialog = within(await within(document.body).findByRole("dialog")); await userEvent.click(dialog.getByRole("button", { name: "Add Rule" })); await expect(dialog.getByLabelText("Match (substring, case-insensitive)")).toHaveAttribute("aria-invalid", "true"); } };
export const SaveError = { args: { onSave: async () => { throw new Error("Save failed"); } }, play: async () => { const dialog = within(await within(document.body).findByRole("dialog")); await userEvent.click(dialog.getByRole("button", { name: "Save" })); await expect(await dialog.findByRole("alert")).toHaveTextContent("Save failed"); } };
export const Pending = { args: { onSave: () => new Promise(() => {}) }, play: async () => { const dialog = within(await within(document.body).findByRole("dialog")); await userEvent.click(dialog.getByRole("button", { name: "Save" })); await expect(dialog.getByRole("button", { name: "Saving..." })).toBeDisabled(); } };
