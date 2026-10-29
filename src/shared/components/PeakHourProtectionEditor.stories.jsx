import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import PeakHourProtectionEditor, { cloneForEdit } from "./PeakHourProtectionEditor";

function Controlled({ initial }) {
  const [value, setValue] = useState(initial);
  return <PeakHourProtectionEditor value={value} onChange={setValue} />;
}

export default { title: "Production/shared-config/PeakHourProtectionEditor", component: PeakHourProtectionEditor, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/example" } } };

export const Empty = { render: () => <Controlled initial={cloneForEdit(null)} /> };

export const ConfiguredWindow = {
  render: () => <Controlled initial={cloneForEdit({ enabled: true, mode: "avoid", windows: [{ name: "Weekday peak", days: ["mon", "tue"], startUtc: "17:00", endUtc: "20:00" }] })} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByLabelText("Enable peak-hour protection")).toBeChecked();
    await userEvent.click(canvas.getByRole("button", { name: "Wed" }));
    expect(canvas.getByRole("button", { name: "Wed" })).toHaveAttribute("aria-pressed", "true");
  },
};
