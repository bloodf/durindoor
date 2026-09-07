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
    const toggle = canvas.getByLabelText("Open navigation menu");
    await userEvent.click(toggle);
    await expect(canvas.getByLabelText("Close navigation menu")).toBeInTheDocument();
  },
};
