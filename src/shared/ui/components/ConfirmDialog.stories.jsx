import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import ConfirmDialog from "./ConfirmDialog";

/**
 * Durin DS/Overlays — ConfirmDialog stories (window.confirm replacement).
 *
 * Both stories record the last choice under the trigger so confirm/cancel
 * wiring is visible without devtools. Danger uses the red confirm button
 * (destructive actions only); Primary uses the gold accent.
 */

const TRIGGER_CLASS =
  "min-h-11 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus";

const DANGER_TRIGGER_CLASS =
  "min-h-11 rounded-dd bg-dd-danger px-3.5 text-[13px] font-medium text-dd-on-danger outline-none transition-colors hover:opacity-90 focus-visible:shadow-dd-focus";

function ConfirmDemo({ triggerClass, resultIdle, ...dialogProps }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(resultIdle);
  return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" className={triggerClass} onClick={() => setOpen(true)}>
        {dialogProps.triggerLabel}
      </button>
      <span className="text-xs text-dd-muted">{result}</span>
      <ConfirmDialog
        {...dialogProps}
        open={open}
        onConfirm={() => {
          setResult("Confirmed.");
          setOpen(false);
        }}
        onCancel={() => {
          setResult("Cancelled.");
          setOpen(false);
        }}
      />
    </div>
  );
}

const meta = {
  title: "Durin DS/Overlays/ConfirmDialog",
  component: ConfirmDialog,
  parameters: { layout: "centered" },
};

export default meta;

export const Danger = {
  render: () => (
    <ConfirmDemo
      triggerClass={DANGER_TRIGGER_CLASS}
      triggerLabel="Delete combo engineer"
      resultIdle="The combo engineer still stands."
      title="Delete combo engineer?"
      message="This removes the engineer from every combo that references it and cannot be undone. Existing routes will fall back to the next engineer in the chain."
      confirmLabel="Delete"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Delete combo engineer" }));
    const dialog = within(document.body);
    const dialogEl = await dialog.findByRole("dialog", { name: "Delete combo engineer?" });
    await Promise.all(dialogEl.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect?.getTiming?.().iterations)).map(({ finished }) => finished.catch(() => {})));
    await expect(dialogEl).toBeVisible();
    await expect(dialog.getByText("This removes the engineer from every combo that references it and cannot be undone. Existing routes will fall back to the next engineer in the chain.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Delete" })).toBeVisible();
  },
};

export const Primary = {
  render: () => (
    <ConfirmDemo
      triggerClass={TRIGGER_CLASS}
      triggerLabel="Regenerate gateway key"
      resultIdle="Current key unchanged."
      title="Regenerate gateway key?"
      message="The old key stops working immediately. Any CLI tool still configured with it will need the new key."
      tone="primary"
      confirmLabel="Regenerate"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Regenerate gateway key" }));
    const dialog = within(document.body);
    const dialogEl = await dialog.findByRole("dialog", { name: "Regenerate gateway key?" });
    await Promise.all(dialogEl.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect?.getTiming?.().iterations)).map(({ finished }) => finished.catch(() => {})));
    await expect(dialogEl).toBeVisible();
    await expect(dialog.getByText("The old key stops working immediately. Any CLI tool still configured with it will need the new key.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Regenerate" })).toBeVisible();
  },
};
