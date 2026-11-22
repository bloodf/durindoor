import React from "react";
import { expect, userEvent, within } from "storybook/test";
import Component from "./EditCompatibleNodeModal";
export default { title: "Production/providers/EditCompatibleNodeModal", component: Component, args: { isOpen: true, node: { id: "node", name: "Example", prefix: "example", baseUrl: "https://example.com/v1" }, onSave: async () => {}, onClose: () => {} }, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: {} } } };
export const Open = { play: async () => { await expect(await within(document.body).findByRole("dialog", { name: "Edit OpenAI Compatible" })).toBeVisible(); } };
export const Pending = { args: { onSave: () => new Promise(() => {}) }, play: async () => { const dialog = await within(document.body).findByRole("dialog"); await userEvent.click(within(dialog).getByRole("button", { name: "Save" })); await expect(within(dialog).getByRole("button", { name: "Saving..." })).toBeDisabled(); } };
export const SaveError = { args: { onSave: async () => { throw new Error("Save failed"); } }, play: async () => { const dialog = await within(document.body).findByRole("dialog"); await userEvent.click(within(dialog).getByRole("button", { name: "Save" })); await expect(await within(dialog).findByRole("alert")).toHaveTextContent("Save failed"); } };
