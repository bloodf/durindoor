import React from "react";
import { expect, within } from "storybook/test";
import AuthLayout from "./AuthLayout";

const meta = { title: "Production/shell/AuthLayout", component: AuthLayout };
export default meta;
export const Card = {
  args: { children: <div className="rounded-dd-lg border border-dd-border bg-dd-surface p-6 text-dd-text">Sign in</div> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Sign in")).toBeVisible();
  },
};
