import { useState } from "react";

import Input from "./Input.jsx";
import RangeSelector, { rangeLabel } from "./RangeSelector.jsx";
import Select from "./Select.jsx";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "healthy", label: "Healthy" },
  { value: "warning", label: "Warning" },
];

function ControlledRange({ defaultValue = { preset: "7d" }, ...props }) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="flex flex-col items-start gap-2">
      <RangeSelector {...props} value={value} onChange={setValue} />
      <span className="text-xs text-dd-subtle">{rangeLabel(value)}</span>
    </div>
  );
}

function ToolbarExample() {
  const [range, setRange] = useState({ preset: "1m" });
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");

  return (
    <div className="flex items-center gap-2 rounded-dd-lg border border-dd-border bg-dd-surface p-3 shadow-dd-elevated">
      <div className="w-36">
        <Select
          size="sm"
          options={STATUS_OPTIONS}
          value={status}
          onChange={setStatus}
          aria-label="Status"
        />
      </div>
      <div className="w-44">
        <Input
          size="sm"
          icon="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter results"
          aria-label="Filter results"
        />
      </div>
      <RangeSelector size="sm" value={range} onChange={setRange} />
    </div>
  );
}

const meta = {
  title: "Durin DS/Data/RangeSelector",
  component: RangeSelector,
  parameters: { layout: "centered" },
};

export default meta;

export const Default = {
  render: () => <ControlledRange />,
};

export const CustomOpen = {
  render: () => (
    <ControlledRange
      defaultValue={{ preset: "custom", from: "2026-05-01", to: "2026-08-30" }}
    />
  ),
};

export const Small = {
  render: () => <ControlledRange size="sm" defaultValue={{ preset: "15d" }} />,
};

export const InToolbar = {
  render: () => <ToolbarExample />,
};
