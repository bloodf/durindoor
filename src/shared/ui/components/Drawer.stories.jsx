import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import Drawer from "./Drawer";

const TRIGGER_CLASS = "min-h-11 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none focus-visible:shadow-dd-focus";
const SECONDARY_CLASS = "min-h-11 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none focus-visible:shadow-dd-focus";

function DrawerDemo({ title = "Edit connection", pending = false, width = 420, long = false }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={TRIGGER_CLASS} onClick={() => setOpen(true)}>Open {title}</button>
    <Drawer open={open} onClose={() => setOpen(false)} title={title} width={width} pending={pending} initialFocus="input"
      footer={<><button type="button" className={SECONDARY_CLASS} onClick={() => setOpen(false)}>Cancel</button><button type="button" className={TRIGGER_CLASS}>Save changes</button></>}
    >
      <label className="flex flex-col gap-2"><span className="text-dd-muted">Connection name</span><input autoFocus className="h-11 rounded-dd border border-dd-border px-3" defaultValue="Moria west gate" /></label>
      {long ? Array.from({ length: 20 }, (_, index) => <p key={index} className="mt-3 text-dd-muted">Scrollable drawer item {index + 1}</p>) : null}
    </Drawer>
  </>;
}

const meta = { title: "Durin DS/Overlays/Drawer", component: Drawer, parameters: { layout: "centered" } };
export default meta;

export const Keyboard = {
  render: () => <DrawerDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Open Edit connection" });
    await userEvent.click(trigger);
    const body = within(document.body);
    const dialog = body.getByRole("dialog", { name: "Edit connection" });
    await expect(dialog).toHaveAttribute("open");
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Connection name" })).toHaveFocus());
    // Native Escape is verified by Playwright's real keyboard, not synthetic events.
    const close = within(dialog).getByRole("button", { name: "Close" });
    close.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(body.queryByRole("dialog", { name: "Edit connection" })).toBeNull();
      expect(trigger).toHaveFocus();
    });
  },
};
export const Busy = { render: () => <DrawerDemo title="Saving connection" pending />, play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "Open Saving connection" })); await expect(document.querySelector("dialog button[aria-label='Close']")).toBeDisabled(); } };
export const Cancel = {
  render: () => <DrawerDemo title="Cancel drawer" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open Cancel drawer" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Cancel drawer" });
    await Promise.all(dialog.getAnimations().map(({ finished }) => finished.catch(() => {})));
    await expect(dialog).toHaveAttribute("open");
    await expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();
  },
};
export const LongContent = {
  render: () => <DrawerDemo title="Request inspector" width={560} long />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open Request inspector" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Request inspector" });
    await Promise.all(dialog.getAnimations({ subtree: true }).map(({ finished }) => finished.catch(() => {})));
    await expect(dialog).toHaveAttribute("open");
    await waitFor(() => expect(within(dialog).getByText("Scrollable drawer item 20")).toBeVisible());
  },
};
export const Mobile = {
  render: () => <DrawerDemo title="Mobile drawer" />,
  parameters: { viewport: { defaultViewport: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open Mobile drawer" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Mobile drawer" });
    await Promise.all(dialog.getAnimations({ subtree: true }).map(({ finished }) => finished.catch(() => {})));
    await expect(dialog).toHaveAttribute("open");
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Connection name" })).toBeVisible());
  },
};
