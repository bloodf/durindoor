import Modal from "./Modal";

/**
 * Durin DS — ConfirmDialog.
 *
 * Drop-in replacement for `window.confirm`, built on {@link Modal}.
 * `tone="danger"` (default) renders the confirm action in `dd-danger` red —
 * the ONLY case red is an action color. `tone="primary"` uses emerald
 * `dd-accent` for affirmative, non-destructive confirmations.
 *
 * Esc / backdrop click / Cancel all route to `onCancel`; the confirm button
 * routes to `onConfirm`. Closing semantics after either callback belong to
 * the caller.
 */

const CONFIRM_TONES = {
  danger: "bg-dd-danger-action text-dd-on-danger hover:bg-dd-danger-action-hover focus-visible:shadow-dd-focus",
  primary: "bg-dd-accent text-dd-on-accent hover:bg-dd-accent-hover",
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  pendingLabel = confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  pending = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      pending={pending}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="min-h-11 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`min-h-11 rounded-dd px-3.5 text-[13px] font-medium outline-none transition-colors focus-visible:shadow-dd-focus disabled:cursor-not-allowed disabled:opacity-50 ${CONFIRM_TONES[tone] ?? CONFIRM_TONES.danger}`}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[13px] leading-relaxed text-dd-muted">{message}</div>
    </Modal>
  );
}
