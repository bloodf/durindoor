import { useState } from "react";
import Tabs from "./Tabs";

/**
 * Durin DS/Choice — Tabs stories.
 *
 * Underline tabs with icons, neutral count pills and a disabled tab.
 * Stateful wrappers keep every story clickable and make the tablist
 * keyboard behavior (arrows + Home/End, roving tabindex, automatic
 * activation) testable on the canvas.
 */

/** Stateful wrapper so CSF3 `render` functions stay hook-free. */
function StatefulTabs({ value: initial, ...props }) {
  const [value, setValue] = useState(initial);
  return <Tabs {...props} value={value} onChange={setValue} />;
}

const PLAIN_TABS = [
  { value: "overview", label: "Overview" },
  { value: "providers", label: "Providers" },
  { value: "activity", label: "Activity" },
  { value: "logs", label: "Logs" },
];

const ICON_TABS = [
  { value: "overview", label: "Overview", icon: "dashboard" },
  { value: "providers", label: "Providers", icon: "cable" },
  { value: "activity", label: "Activity", icon: "monitoring" },
  { value: "logs", label: "Logs", icon: "article" },
];

const COUNT_TABS = [
  { value: "overview", label: "Overview", icon: "dashboard" },
  { value: "providers", label: "Providers", icon: "cable", count: 12 },
  { value: "activity", label: "Activity", icon: "monitoring", count: 128 },
  { value: "logs", label: "Logs", icon: "article", count: 4 },
];

const meta = {
  title: "Durin DS/Choice/Tabs",
  component: Tabs,
  parameters: { layout: "centered" },
};

export default meta;

export const Default = {
  render: (args) => <StatefulTabs {...args} />,
  args: {
    tabs: PLAIN_TABS,
    value: "overview",
    "aria-label": "Gateway sections",
  },
};

export const WithIcons = {
  render: (args) => <StatefulTabs {...args} />,
  args: {
    tabs: ICON_TABS,
    value: "providers",
    "aria-label": "Gateway sections",
  },
};

export const WithCounts = {
  render: (args) => <StatefulTabs {...args} />,
  args: {
    tabs: COUNT_TABS,
    value: "activity",
    "aria-label": "Gateway sections",
  },
};

export const WithDisabledTab = {
  render: (args) => <StatefulTabs {...args} />,
  args: {
    tabs: [
      { value: "overview", label: "Overview", icon: "dashboard" },
      { value: "providers", label: "Providers", icon: "cable", count: 12 },
      { value: "activity", label: "Activity", icon: "monitoring" },
      { value: "logs", label: "Logs", icon: "article", disabled: true },
    ],
    value: "overview",
    "aria-label": "Gateway sections",
  },
};
