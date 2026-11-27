import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import Component from "./CookieImportModal";
export default { title: "Production/providers/CookieImportModal", component: Component, args: { isOpen: true, provider: "grok-web", providerName: "Grok", importContract: { cookieNames: ["sso"] }, onSuccess: () => {}, onClose: () => {} }, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: {} } } };
export const Open = { play: async () => { await expect(await within(document.body).findByRole("dialog", { name: "Import Grok cookies" })).toBeVisible(); } };
export const InvalidInput = { play: async () => { const dialog = within(await within(document.body).findByRole("dialog")); await userEvent.type(dialog.getByLabelText("Cookie header or cURL command"), "invalid"); await userEvent.click(dialog.getByRole("button", { name: "Read input" })); await waitFor(() => expect(dialog.getByRole("alert")).toBeVisible()); } };
export const Pending = {
  args: { importContract: { origin: "https://example.com", cookieNames: [], localStorageKeys: ["token"] } },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: { "POST /api/providers/cookie-import/pairing": () => new Promise(() => {}) } } },
  play: async () => {
    const dialog = within(await within(document.body).findByRole("dialog", { name: "Import Grok session" }));
    await userEvent.type(dialog.getByLabelText("Connection name"), "Example");
    await userEvent.type(dialog.getByLabelText("localStorage token"), "credential");
    await userEvent.click(dialog.getByRole("button", { name: "Import session" }));
    await expect(dialog.getByRole("button", { name: "Import session" })).toBeDisabled();
  },
};

export const VeoExistingSession = {
  args: {
    provider: "veoaifree-web", providerName: "Veo AI Free Web",
    importContract: { origin: "https://veoaifree.com", cookieNames: [], cookiePrefixes: [], hashedCookiePrefixes: ["wordpress_logged_in_"], authType: "apikey" },
    connections: [
      { id: "veo-session", name: "Saved Veo session", provider: "veoaifree-web", authType: "apikey" },
      { id: "anonymous", name: "Anonymous", provider: "veoaifree-web", authType: "none" },
      { id: "oauth", name: "OAuth", provider: "veoaifree-web", authType: "oauth" },
      { id: "foreign", name: "Foreign", provider: "other", authType: "apikey" },
    ],
  },
  play: async () => {
    const dialog = within(await within(document.body).findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Replace cookies" }));
    const select = dialog.getByRole("combobox");
    await expect(within(select).getAllByRole("option")).toHaveLength(2);
    await userEvent.selectOptions(select, "veo-session");
    await userEvent.click(dialog.getByRole("button", { name: "Browser extension" }));
    await expect(dialog.getByRole("button", { name: "Create pairing" })).toBeEnabled();
  },
};
