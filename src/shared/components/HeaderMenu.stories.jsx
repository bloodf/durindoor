import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import HeaderMenu from "./HeaderMenu";

const meta = { title: "Production/shell/HeaderMenu", component: HeaderMenu, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/usage", routes: { "POST /api/version/shutdown": { body: {} } } } } };
export default meta;
/** Covers private flyout and native DS shutdown dialog. */
export const ShutdownConfirm = {
  args: { onLogout: () => undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTitle("Menu"));
    await userEvent.click(canvas.getByText("Shutdown"));
    const dialog = await within(document.body).findByRole("dialog", { name: "Close Proxy" });
    await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished));
    await waitFor(() => expect(within(document.body).getByText("Close Proxy")).toBeVisible());
  },
};
