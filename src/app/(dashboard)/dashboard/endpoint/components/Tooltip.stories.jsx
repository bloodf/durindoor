import React from "react";
import { expect, userEvent, within } from "storybook/test";

import Tooltip from "./Tooltip";

const meta = {
  title: "Production/endpoint/Tooltip",
  component: Tooltip,
  parameters: { layout: "centered" },
  args: {
    text: "When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required).",
  },
};

export default meta;

export const Default = {};

/** Hover the trigger and assert the DS tooltip bubble exposes the same descriptive text. */
export const HoverRevealsBubble = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: "More information" });
    await userEvent.hover(trigger);
    const bubble = await within(document.body).findByRole("tooltip");
    await expect(bubble).toHaveTextContent("dashboard can be accessed");
  },
};
