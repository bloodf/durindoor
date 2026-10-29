import React from "react";
import { expect, userEvent, within } from "storybook/test";
import Navigation from "./Navigation.js";

export default {
  title: "Production/Public/Landing/Navigation",
  component: Navigation,
  parameters: { layout: "fullscreen" },
};

export const Default = { render: () => <Navigation /> };

export const MobileMenuOpen = {
  render: () => <Navigation />,
  parameters: { viewport: { defaultViewport: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    if (window.matchMedia("(min-width: 768px)").matches) {
      // The canonical matrix also renders this story at desktop width, where
      // production intentionally has no mobile-menu control.
      await expect(canvas.getByRole("link", { name: "Features" })).toBeVisible();
      await expect(canvas.getByRole("link", { name: "How it works" })).toBeVisible();
    } else {
      await userEvent.click(canvas.getByRole("button", { name: "Open navigation menu" }));
      await expect(canvas.getByRole("button", { name: "Close navigation menu" })).toBeVisible();
      await expect(canvas.getByRole("link", { name: "Features" })).toBeVisible();
    }
  },
};
