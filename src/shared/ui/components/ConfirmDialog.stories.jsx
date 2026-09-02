import { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

/**
 * Durin DS/Overlays — ConfirmDialog stories (window.confirm replacement).
 *
 * Both stories record the last choice under the trigger so confirm/cancel
 * wiring is visible without devtools. Danger uses the red confirm button
 * (destructive actions only); Primary uses the gold accent.
 */

const TRIGGER_CLASS =
  "h-9 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus";

const DANGER_TRIGGER_CLASS =
  "h-9 rounded-dd bg-dd-danger px-3.5 text-[13px] font-medium text-dd-on-danger outline-none transition-colors hover:opacity-90 focus-visible:shadow-dd-focus";

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
};
