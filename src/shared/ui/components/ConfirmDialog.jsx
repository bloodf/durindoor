import Modal from "./Modal";

/**
 * Durin DS — ConfirmDialog.
 *
 * Drop-in replacement for `window.confirm`, built on {@link Modal}.
 * `tone="danger"` (default) renders the confirm action in `dd-danger` red —
 * the ONLY case red is an action color. `tone="primary"` uses the gold
 * `dd-accent` for affirmative, non-destructive confirmations.
 *
 * Esc / backdrop click / Cancel all route to `onCancel`; the confirm button
 * routes to `onConfirm`. Closing semantics after either callback belong to
 * the caller.
 */

const CONFIRM_TONES = {
  danger: "bg-dd-danger text-dd-on-danger hover:opacity-90",
  primary: "bg-dd-accent text-dd-on-accent hover:bg-dd-accent-hover",
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`h-9 rounded-dd px-3.5 text-[13px] font-medium outline-none transition-colors focus-visible:shadow-dd-focus ${CONFIRM_TONES[tone] ?? CONFIRM_TONES.danger}`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[13px] leading-relaxed text-dd-muted">{message}</div>
    </Modal>
  );
}
