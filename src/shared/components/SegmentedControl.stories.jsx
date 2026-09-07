import React, { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import SegmentedControl from "./SegmentedControl.js";

/**
 * Production lane coverage map for `SegmentedControl`. Visual widget lives in
 * the owned production file.
 *
 * Verified owned importer (via barrel `@/shared/components`):
 *   - `app/(dashboard)/dashboard/usage/page.js` (Overview / Details tab switch).
 *
 * The component's public API also supports per-option `icon` and `disabled`
 * even though current owned consumers do not exercise them. Stories cover the
 * consumer's actual usage plus the private-widget axes (icon, disabled,
 * compact, RTL) so future ports can rely on the documented behavior.
 */
const RANGE_OPTIONS = [
  { value: "1d", label: "1D" },
  { value: "7d", label: "7D" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M", disabled: true },
  { value: "all", label: "All" },
];

const meta = {
  title: "Production/shared-actions/SegmentedControl",
  component: SegmentedControl,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Owned production SegmentedControl (radiogroup, roving tabindex, Arrow/Home/End, 44px targets, RTL-aware horizontal movement). Sole verified owned importer: `app/(dashboard)/dashboard/usage/page.js` (Overview / Details). Per-option `icon` and `disabled` are exercised in stories for future portability.",
      },
    },
  },
};

export default meta;

function ControlledDemo({ options, initialValue = "7d", ...props }) {
  const [value, setValue] = useState(initialValue);
  return <SegmentedControl {...props} options={options ?? RANGE_OPTIONS} value={value} onChange={setValue} />;
}

export const Default = {
  render: () => <ControlledDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByRole("radio", { name: "7D" })).toHaveAttribute("aria-checked", "true");
    });
  },
};

export const UsageOverviewDetails = {
  name: "Usage page Overview / Details",
  render: () => (
    <ControlledDemo
      initialValue="overview"
      options={[
        { value: "overview", label: "Overview" },
        { value: "details", label: "Details" },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByRole("radio", { name: "Overview" })).toHaveAttribute("aria-checked", "true");
    });
  },
};

export const DisabledOption = {
  name: "Disabled option (private widget)",
  render: () => <ControlledDemo initialValue="1d" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByRole("radio", { name: "1D" })).toHaveAttribute("aria-checked", "true");
      expect(canvas.getByRole("radio", { name: "3M" })).toBeDisabled();
    });
  },
};

export const PerOptionIcon = {
  name: "Per-option icon (private widget)",
  render: () => (
    <ControlledDemo
      size="sm"
      initialValue="grid"
      options={[
        { value: "grid", label: "Grid", icon: "grid_view" },
        { value: "list", label: "List", icon: "view_list" },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByRole("radio", { name: /Grid/ })).toHaveAttribute("aria-checked", "true");
    });
  },
};

export const LargeSize = {
  name: "lg density (private widget)",
  render: () => <ControlledDemo size="lg" />,
};

export const LtrKeyboard = {
  name: "LTR keyboard traversal (private widget)",
  render: () => <ControlledDemo initialValue="1d" dir="ltr" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstDay = canvas.getByRole("radio", { name: "1D" });
    firstDay.focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => {
      const week = canvas.getByRole("radio", { name: "7D" });
      expect(week).toHaveAttribute("aria-checked", "true");
      expect(week).toHaveFocus();
    });
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => {
      expect(firstDay).toHaveAttribute("aria-checked", "true");
      expect(firstDay).toHaveFocus();
    });
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => {
      // First ArrowLeft from 1D wraps past disabled 3M to last enabled option.
      const all = canvas.getByRole("radio", { name: "All" });
      expect(all).toHaveAttribute("aria-checked", "true");
      expect(all).toHaveFocus();
    });
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => {
      // From All, one more ArrowLeft proves 3M is skipped and 1M is selected.
      const oneMonth = canvas.getByRole("radio", { name: "1M" });
      expect(oneMonth).toHaveAttribute("aria-checked", "true");
      expect(oneMonth).toHaveFocus();
    });
  },
};

export const RtlKeyboard = {
  name: "RTL keyboard traversal (private widget)",
  // storyFixture.locale:'ar' drives decorator → html dir='rtl'; the component
  // additionally sets dir='rtl' on the native radiogroup so its
  // getComputedStyle().direction contract holds even if a sibling remount
  // temporarily restores document direction.
  parameters: { storyFixture: { locale: "ar" } },
  render: () => <ControlledDemo initialValue="1d" dir="rtl" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstDay = canvas.getByRole("radio", { name: "1D" });
    firstDay.focus();
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("dir", "rtl");
    });
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => {
      const week = canvas.getByRole("radio", { name: "7D" });
      expect(week).toHaveAttribute("aria-checked", "true");
      expect(week).toHaveFocus();
    });
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => {
      expect(firstDay).toHaveAttribute("aria-checked", "true");
      expect(firstDay).toHaveFocus();
    });
  },
};
