import React from "react";
import { expect, userEvent, within } from "storybook/test";
import MfaCard from "./MfaCard.jsx";

export default {
  title: "Production/profile/MfaCard",
  component: MfaCard,
  args: { mfaEnabled: false, mfaBackupCodesRemaining: 0, onChanged: () => {} },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/profile" } },
};

export const Disabled = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Enable two-factor" }));
    await expect(await within(document.body).findByRole("dialog", { name: "Enable two-factor authentication" })).toBeVisible();
  },
};

export const Enabled = {
  args: { mfaEnabled: true, mfaBackupCodesRemaining: 4 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("4 backup codes remaining")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Disable two-factor" }));
    await expect(await within(document.body).findByRole("dialog", { name: "Disable two-factor authentication" })).toBeVisible();
  },
};
