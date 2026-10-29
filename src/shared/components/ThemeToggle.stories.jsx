import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import ThemeToggle from "./ThemeToggle";

const meta = { title: "Production/shell/ThemeToggle", component: ThemeToggle };
export default meta;
export const Default = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole("button", { name: /Switch to (light|dark) mode/ });
    const root = document.documentElement;
    const initialScheme = root.style.colorScheme;
    const invertedScheme = initialScheme === "dark" ? "light" : "dark";
    await expect(btn).toBeVisible();
    await userEvent.click(btn);
    await waitFor(() => expect(root.style.colorScheme).toBe(invertedScheme));
    await expect(btn).toHaveAccessibleName(`Switch to ${initialScheme} mode`);
    await userEvent.click(btn);
    await waitFor(() => expect(root.style.colorScheme).toBe(initialScheme));
    await expect(btn).toHaveAccessibleName(`Switch to ${invertedScheme} mode`);
  },
};
export const Card = { args: { variant: "card" }, play: Default.play };
