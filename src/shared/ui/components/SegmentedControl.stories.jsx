import { useState } from "react";
import SegmentedControl from "./SegmentedControl";

/**
 * Durin DS/Choice — SegmentedControl stories.
 *
 * Covers both sizes, icon segments, a disabled control and a disabled
 * option. Stateful wrappers keep every story clickable and make the
 * radiogroup keyboard behavior (arrows + Home/End, roving tabindex)
 * testable on the canvas.
 */

/** Stateful wrapper so CSF3 `render` functions stay hook-free. */
function StatefulSegmented({ value: initial, ...props }) {
  const [value, setValue] = useState(initial);
  return <SegmentedControl {...props} value={value} onChange={setValue} />;
}

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const VIEW_OPTIONS = [
  { value: "list", label: "List", icon: "view_list" },
  { value: "grid", label: "Grid", icon: "grid_view" },
  { value: "board", label: "Board", icon: "view_kanban" },
];

const meta = {
  title: "Durin DS/Choice/SegmentedControl",
  component: SegmentedControl,
  parameters: { layout: "centered" },
};

export default meta;

export const Default = {
  render: (args) => <StatefulSegmented {...args} />,
  args: {
    options: FILTER_OPTIONS,
    value: "all",
    "aria-label": "Filter providers",
  },
};

export const WithIcons = {
  render: (args) => <StatefulSegmented {...args} />,
  args: {
    options: VIEW_OPTIONS,
    value: "list",
    "aria-label": "Change view",
  },
};

export const Small = {
  render: (args) => <StatefulSegmented {...args} />,
  args: {
    options: FILTER_OPTIONS,
    value: "active",
    size: "sm",
    "aria-label": "Filter providers",
  },
};

export const DisabledControl = {
  args: {
    options: FILTER_OPTIONS,
    value: "active",
    disabled: true,
    "aria-label": "Filter providers",
  },
};

export const DisabledOption = {
  render: (args) => <StatefulSegmented {...args} />,
  args: {
    options: [
      { value: "all", label: "All" },
      { value: "active", label: "Active" },
      { value: "archived", label: "Archived", disabled: true },
    ],
    value: "all",
    "aria-label": "Filter providers",
  },
};
