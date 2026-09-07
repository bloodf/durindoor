import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import Input from "./Input.jsx";
import RangeSelector, { rangeLabel } from "./RangeSelector.jsx";
import Select from "./Select.jsx";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "healthy", label: "Healthy" },
  { value: "warning", label: "Warning" },
];

const DEFAULT_VALUE = { preset: "7d" };

function ControlledRange({ defaultValue = DEFAULT_VALUE, ...props }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="flex max-w-sm flex-col items-start gap-2">
      <RangeSelector {...props} value={value} onChange={setValue} />
      <span className="text-xs text-dd-subtle">{rangeLabel(value)}</span>
      <span data-testid="committed" className="text-xs text-dd-subtle">
        {value.preset === "custom" ? `${value.from} → ${value.to}` : value.preset}
      </span>
    </div>
  );
}

function ToolbarExample() {
  const [range, setRange] = useState({ preset: "1m" });
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");

  return (
    <div className="flex max-w-xl items-center gap-2 rounded-dd-lg border border-dd-border bg-dd-surface p-3 shadow-dd-elevated">
      <div className="w-36">
        <Select size="sm" options={STATUS_OPTIONS} value={status} onChange={setStatus} aria-label="Status" />
      </div>
      <div className="w-44">
        <Input size="sm" icon="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter results" aria-label="Filter results" />
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

export const Default = { render: () => <ControlledRange /> };

export const ValidCustom = {
  render: () => <ControlledRange defaultValue={{ preset: "custom", from: "2026-05-01", to: "2026-08-30" }} />,
};

export const OpenCustom = {
  render: () => <ControlledRange defaultValue={{ preset: "7d" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Custom" }));
    await expect(await canvas.findByRole("dialog", { name: "Custom date range" })).toBeVisible();
  },
};

export const InvalidCustom = {
  render: () => <ControlledRange defaultValue={{ preset: "7d" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Custom" }));
    await userEvent.type(canvas.getByLabelText("From"), "2026-09-10");
    await userEvent.type(canvas.getByLabelText("To"), "2026-09-01");
    await expect(await canvas.findByRole("alert")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Apply" })).toBeDisabled();
  },
};

export const AppliedCustom = {
  render: () => <ControlledRange defaultValue={{ preset: "7d" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Custom" }));
    await userEvent.type(canvas.getByLabelText("From"), "2026-05-01");
    await userEvent.type(canvas.getByLabelText("To"), "2026-08-30");
    await userEvent.click(canvas.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(canvas.queryByRole("dialog", { name: "Custom date range" })).toBeNull());
    await expect(canvas.getByTestId("committed")).toHaveTextContent("2026-05-01 → 2026-08-30");
  },
};

export const CustomCancel = {
  render: () => <ControlledRange defaultValue={{ preset: "7d" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const committed = canvas.getByTestId("committed");
    const before = committed.textContent;
    await userEvent.click(canvas.getByRole("button", { name: /custom/i }));
    await userEvent.type(canvas.getByLabelText("From"), "2026-09-10");
    await userEvent.type(canvas.getByLabelText("To"), "2026-09-01");
    await expect(canvas.getByRole("alert")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(committed).toHaveTextContent(before);
  },
};

export const Small = { render: () => <ControlledRange size="sm" defaultValue={{ preset: "15d" }} /> };

export const Long = {
  render: () => <div className="w-80"><ControlledRange /></div>,
};

export const Narrow = {
  render: () => <div className="w-40"><ControlledRange /></div>,
};

export const Keyboard = {
  render: () => <ControlledRange />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const custom = canvas.getByRole("button", { name: /custom/i });
    custom.focus();
    await userEvent.keyboard("{Enter}");
    await expect(await canvas.findByRole("dialog")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
    await expect(custom).toHaveFocus();
  },
};

export const InToolbar = { render: () => <ToolbarExample /> };
