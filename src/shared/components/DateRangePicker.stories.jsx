import React, { useState } from "react";
import { expect, fireEvent, within } from "storybook/test";
import DateRangePicker from "./DateRangePicker";

const meta = { title: "Production/shared-overlays/DateRangePicker", component: DateRangePicker };
export default meta;

function RangeScenario() {
  const [range, setRange] = useState({ startDate: "2026-08-01", endDate: "2026-09-05" });
  return <DateRangePicker {...range} onChange={setRange} />;
}

export const Default = {
  render: () => <RangeScenario />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const start = canvas.getByLabelText("Range start date");
    const end = canvas.getByLabelText("Range end date");
    fireEvent.change(start, { target: { value: "2026-08-10" } });
    await expect(start).toHaveValue("2026-08-10");
    await expect(end).toHaveValue("2026-09-05");
  },
};

export const Disabled = { args: { startDate: "", endDate: "", disabled: true, onChange: () => {} } };
