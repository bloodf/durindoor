import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import Modal from "./Modal";

const TRIGGER_CLASS =
  "min-h-11 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus";
const SECONDARY_CLASS =
  "min-h-11 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus";

function ModalDemo({ title, subtitle, size = "md", children, pending = false, nested = false, initialFocus }) {
  const [open, setOpen] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);
  return (
    <>
      <button type="button" className={TRIGGER_CLASS} onClick={() => setOpen(true)}>Open {title}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} subtitle={subtitle} size={size} pending={pending} initialFocus={initialFocus}
        footer={<><button type="button" className={SECONDARY_CLASS} onClick={() => setOpen(false)}>Cancel</button><button type="button" className={TRIGGER_CLASS}>Save changes</button></>}
      >
        {children}
        {nested ? <><button type="button" className={SECONDARY_CLASS} onClick={() => setInnerOpen(true)}>Open nested dialog</button><Modal open={innerOpen} onClose={() => setInnerOpen(false)} title="Nested confirmation"><button type="button">Nested action</button></Modal></> : null}
      </Modal>
    </>
  );
}

const meta = { title: "Durin DS/Overlays/Modal", component: Modal, parameters: { layout: "centered" } };
export default meta;

export const Keyboard = {
  render: () => <ModalDemo title="Keyboard modal" subtitle="Focus starts in this native dialog." initialFocus="button[aria-label='Close']"><input aria-label="Connection name" className="h-11 rounded-dd border border-dd-border px-3" /></ModalDemo>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Open Keyboard modal" });
    await userEvent.click(trigger);
    const body = within(document.body);
    const dialog = body.getByRole("dialog", { name: "Keyboard modal" });
    await expect(dialog).toHaveAttribute("open");
    await expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
    // Native Escape is verified by Playwright's real keyboard, not synthetic events.
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(body.queryByRole("dialog", { name: "Keyboard modal" })).toBeNull();
      expect(trigger).toHaveFocus();
    });
  },
};

export const Nested = {
  render: () => <ModalDemo title="Parent dialog" nested>Outer dialog stays open after nested dialog closes.</ModalDemo>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open Parent dialog" }));
    const body = within(document.body);
    const parent = body.getByRole("dialog", { name: "Parent dialog" });
    const nestedTrigger = within(parent).getByRole("button", { name: "Open nested dialog" });
    await userEvent.click(nestedTrigger);
    const nested = body.getByRole("dialog", { name: "Nested confirmation" });
    await expect(nested).toHaveAttribute("open");
    within(nested).getByRole("button", { name: "Close" }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(body.queryByRole("dialog", { name: "Nested confirmation" })).toBeNull();
      expect(body.getByRole("dialog", { name: "Parent dialog" })).toBe(parent);
      expect(nestedTrigger).toHaveFocus();
    });
  },
};

export const Busy = {
  render: () => <ModalDemo title="Saving changes" pending>Dismissal stays disabled while save is pending.</ModalDemo>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open Saving changes" }));
    const dialog = within(document.body).getByRole("dialog", { name: "Saving changes" });
    await expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await expect(within(document.body).getByRole("dialog", { name: "Saving changes" })).toBe(dialog);
  },
};

export const Cancel = {
  render: () => <ModalDemo title="Cancel edit">Cancel and overlay dismissal are enabled by default.</ModalDemo>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open Cancel edit" }));
    const dialog = within(document.body).getByRole("dialog", { name: "Cancel edit" });
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close).not.toBeDisabled();
  },
};


const LORE = Array.from({ length: 18 }, (_, index) => `Chronicle entry ${index + 1}: scrollable content keeps header and footer visible.`);
export const LongContent = {
  render: () => <ModalDemo title="Long content">{LORE.map((text) => <p key={text} className="mb-3 text-dd-muted">{text}</p>)}</ModalDemo>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open Long content" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Long content" });
    // The open transition animates a child of <dialog>, so getAnimations() on the
    // dialog alone can return before content is painted; poll the real visibility.
    await Promise.all(dialog.getAnimations({ subtree: true }).map(({ finished }) => finished.catch(() => {})));
    await expect(dialog).toHaveAttribute("open");
    await waitFor(() => expect(within(dialog).getByText(LORE.at(-1))).toBeVisible());
  },
};
export const Mobile = {
  render: () => <ModalDemo title="Mobile confirmation" size="sm">Responsive modal leaves viewport padding on narrow screens.</ModalDemo>,
  parameters: { viewport: { defaultViewport: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open Mobile confirmation" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Mobile confirmation" });
    await Promise.all(dialog.getAnimations({ subtree: true }).map(({ finished }) => finished.catch(() => {})));
    await expect(dialog).toHaveAttribute("open");
    await waitFor(() => expect(within(dialog).getByText("Responsive modal leaves viewport padding on narrow screens.")).toBeVisible());
  },
};
