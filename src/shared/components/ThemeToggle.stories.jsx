import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import ThemeToggle from "./ThemeToggle";

const meta = { title: "Production/shell/ThemeToggle", component: ThemeToggle };
export default meta;
export const Default = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole("button");
    const previous = document.documentElement.classList.contains("dark");
    await userEvent.click(btn);
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(!previous));
    await userEvent.click(btn);
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(previous));
  },
};
export const Card = { args: { variant: "card" } };
