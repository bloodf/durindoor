import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import Component from "./AddApiKeyModal";
export default { title: "Production/providers/AddApiKeyModal", component: Component, args: { isOpen: true, provider: "openai", providerName: "OpenAI", onSave: async () => {}, onClose: () => {} }, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: {} } } };
export const Open = { play: async () => { await expect(await within(document.body).findByRole("dialog", { name: "Add OpenAI API Key" })).toBeVisible(); } };
export const Pending = {
  args: { onSave: () => new Promise(() => {}) },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: { "POST /api/providers/validate": { body: { valid: true } } } } },
  play: async () => { const dialog = within(await within(document.body).findByRole("dialog")); await userEvent.type(dialog.getByLabelText("API Key"), "sk-example"); await userEvent.click(dialog.getByRole("button", { name: "Save" })); await expect(await dialog.findByRole("button", { name: "Saving..." })).toBeDisabled(); },
};
export const SaveError = { args: { error: "Could not save key" }, play: async () => { const dialog = within(await within(document.body).findByRole("dialog")); await waitFor(() => expect(dialog.getByText("Could not save key")).toBeVisible()); } };
