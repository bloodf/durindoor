import React from "react";
import { expect, userEvent, within } from "storybook/test";

import CapacityBadges from "./CapacityBadges.js";

const meta = {
  title: "Production/Shared Surfaces/CapacityBadges",
  component: CapacityBadges,
  parameters: { layout: "centered" },
};

export default meta;

export const Playground = {
  args: { caps: { vision: true, reasoning: true, tools: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("visibility")).toBeInTheDocument();
    await expect(canvas.getByText("neurology")).toBeInTheDocument();
    await expect(canvas.getByText("build")).toBeInTheDocument();
  },
};

export const AllCapabilities = {
  render: () => (
    <div className="flex flex-col gap-3">
      <CapacityBadges caps={{ vision: true, reasoning: true, tools: true }} />
      <CapacityBadges caps={{ vision: true }} />
      <CapacityBadges caps={{ reasoning: true }} />
      <CapacityBadges caps={{ tools: true }} />
    </div>
  ),
};

export const ColorOverride = {
  render: () => (
    <div className="flex flex-col gap-3">
      <CapacityBadges caps={{ vision: true, reasoning: true, tools: true }} colorOverride="text-dd-text" />
      <CapacityBadges caps={{ tools: true }} colorOverride="text-dd-accent" />
    </div>
  ),
};

export const SizeScale = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <CapacityBadges caps={{ vision: true, tools: true }} size={12} />
      <CapacityBadges caps={{ vision: true, tools: true }} size={16} />
      <CapacityBadges caps={{ vision: true, tools: true }} size={20} />
      <CapacityBadges caps={{ vision: true, tools: true }} size={24} />
    </div>
  ),
};

export const EmptyOrMissingCaps = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CapacityBadges caps={{}} />
        <span className="text-[11px] text-dd-muted">empty object → null (no badges)</span>
      </div>
      <div className="flex items-center gap-2">
        <CapacityBadges caps={null} />
        <span className="text-[11px] text-dd-muted">null → null</span>
      </div>
      <div className="flex items-center gap-2">
        <CapacityBadges caps={{ search: true }} />
        <span className="text-[11px] text-dd-muted">unmapped cap keys → null</span>
      </div>
    </div>
  ),
};

export const KeyboardFocusRevealsTooltip = {
  render: () => (
    <div className="flex items-center gap-3">
      <CapacityBadges caps={{ vision: true, tools: true }} />
      <span className="text-[11px] text-dd-muted">Tab focuses each badge; tooltip content becomes accessible</span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const visionBadge = canvas.getByRole("img", { name: /Vision/ });
    // Reach the badge the way a keyboard user does; this story exists to
    // prove tab order reaches it, so a direct focus() call would assert
    // nothing about the behaviour it is named for.
    await userEvent.tab();
    await expect(visionBadge).toHaveFocus();
    // The Tooltip popover is always mounted (hidden until focus). Select the
    // visible Vision one by matching its label text — there are two persistent
    // tooltips in the DOM (Vision + Tools).
    const visionTooltip = within(document.body).getByText("Vision — Supports image input");
    // Let the reveal finish before asserting, so the keyboard path stays under
    // test without racing its own transition.
    await Promise.all(visionTooltip.getAnimations({ subtree: true })
      .filter((animation) => Number.isFinite(animation.effect?.getTiming?.().iterations))
      .map(({ finished }) => finished.catch(() => {})));
    await expect(visionTooltip).toBeVisible();

    await userEvent.tab();
    const toolsBadge = canvas.getByRole("img", { name: /Tools/ });
    await expect(toolsBadge).toHaveFocus();
  },
};
