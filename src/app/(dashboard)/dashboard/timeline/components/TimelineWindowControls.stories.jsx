import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import TimelineWindowControls from "./TimelineWindowControls.jsx";

function ControlsHarness() {
  const [windowKey, setWindowKey] = useState("15m");
  const [laneBy, setLaneBy] = useState("provider");
  const [live, setLive] = useState(false);
  return <TimelineWindowControls windowKey={windowKey} onWindowChange={setWindowKey} laneBy={laneBy} onLaneByChange={setLaneBy} live={live} onLiveChange={setLive} />;
}

export default {
  title: "Production/timeline/TimelineWindowControls",
  component: TimelineWindowControls,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/timeline" } },
};

export const Default = {
  render: () => <ControlsHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("radio", { name: "15m" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(canvas.getByRole("radio", { name: "1h" }));
    await expect(canvas.getByRole("radio", { name: "1h" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(canvas.getByRole("combobox", { name: "Group lanes by" }));
    await userEvent.click(within(document.body).getByRole("option", { name: "Connection" }));
    await expect(canvas.getByRole("combobox", { name: "Group lanes by" })).toHaveTextContent("Connection");
    await userEvent.click(canvas.getByRole("switch", { name: "Live timeline updates" }));
    await expect(canvas.getByRole("switch", { name: "Live timeline updates" })).toBeChecked();
  },
};
