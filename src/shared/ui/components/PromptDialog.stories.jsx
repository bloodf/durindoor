import { useState } from "react";
import PromptDialog from "./PromptDialog";

/**
 * Durin DS/Overlays — PromptDialog stories (window.prompt replacement).
 *
 * The submitted value renders under the trigger to prove the wiring. The
 * input autofocuses on open, Enter submits, Esc cancels, and Save stays
 * disabled while the value is empty or whitespace-only. Reopening always
 * re-seeds the field from `defaultValue`.
 */

const TRIGGER_CLASS =
  "h-9 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus";

function PromptDemo({ triggerLabel, ...dialogProps }) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" className={TRIGGER_CLASS} onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      <span className="max-w-xs truncate text-xs text-dd-muted">
        {submitted === null ? "Nothing saved yet." : `Saved: ${submitted}`}
      </span>
      <PromptDialog
        {...dialogProps}
        open={open}
        onSubmit={(value) => {
          setSubmitted(value);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

const meta = {
  title: "Durin DS/Overlays/PromptDialog",
  component: PromptDialog,
  parameters: { layout: "centered" },
};

export default meta;

export const Default = {
  render: () => (
    <PromptDemo
      triggerLabel="Name gateway key"
      title="Name this gateway key"
      label="Gateway key name (optional)"
      placeholder="e.g. ci-runner-01"
    />
  ),
};

export const WithDefaultValue = {
  render: () => (
    <PromptDemo
      triggerLabel="Rename connection"
      title="Rename connection"
      label="Connection name"
      defaultValue="Production gateway"
      submitLabel="Rename"
    />
  ),
};
