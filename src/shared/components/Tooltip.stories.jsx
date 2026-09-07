import React from "react";
import { expect, userEvent, waitFor } from "storybook/test";
import Tooltip from "./Tooltip";

const meta = { title: "Production/shared-overlays/Tooltip", component: Tooltip };
export default meta;

export const OnIconButton = {
  render: () => (
    <Tooltip text="Close">
      <button type="button" aria-label="Close">×</button>
    </Tooltip>
  ),
  play: async () => {
    const trigger = document.querySelector('button[aria-label="Close"]');
    const tooltip = document.querySelector('[role="tooltip"]');
    // Source mounts the bubble hidden until trigger interaction.
    expect(tooltip).not.toBeVisible();
    trigger.focus();
    await waitFor(() => {
      expect(tooltip).toBeVisible();
      expect(tooltip).toHaveTextContent("Close");
    });
  },
};

export const OnFocusableIcon = {
  render: () => (
    <Tooltip text="Tooltip top" position="top">
      <span className="material-symbols-outlined">info</span>
    </Tooltip>
  ),
  play: async () => {
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeVisible();
    // Source wraps non-focusable children with tabIndex=0.
    await userEvent.tab();
    await waitFor(() => {
      expect(tooltip).toBeVisible();
      expect(tooltip).toHaveTextContent("Tooltip top");
    });
  },
};
