import React, { useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import Drawer from "./Drawer";

const meta = { title: "Production/shared-overlays/Drawer", component: Drawer };
export default meta;

function DrawerScenario() {
  const [open, setOpen] = useState(true);
  return <><button type="button" onClick={() => setOpen(true)}>Open request details</button><Drawer isOpen={open} onClose={() => setOpen(false)} title="Request details" width="lg"><p>Drawer body retains request detail content and scroll behavior.</p></Drawer></>;
}

export const Default = {
  render: () => <DrawerScenario />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Request details" })).toBeVisible());
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Request details" })).toBeNull());
    await userEvent.click(canvas.getByRole("button", { name: "Open request details" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Request details" })).toBeVisible());
  },
};
