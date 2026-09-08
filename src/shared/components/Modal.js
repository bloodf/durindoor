"use client";

import DSModal from "@/shared/ui/components/Modal.jsx";

/**
 * Legacy modal API composed over authoritative Durin DS Modal. The foundation
 * owns native-dialog focus/return, scroll lock, Escape/backdrop dismissal,
 * and surface sizing; its size map includes legacy xl and Main is adding full.
 * `showTrafficLights` remains accepted for caller compatibility; DS renders
 * one accessible close control instead of decorative traffic lights.
 * `className` forwards to DS `surfaceClassName` (targets the inner surface,
 * not the outer dialog).
 */
const CONFIRM_TONES = {
  danger: "bg-dd-danger text-dd-on-danger hover:opacity-90",
  success: "bg-dd-success text-dd-on-accent hover:opacity-90",
  primary: "bg-dd-accent text-dd-on-accent hover:bg-dd-accent-hover",
};

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnOverlay = true,
  showTrafficLights: _showTrafficLights = true,
  className,
  closeOnEscape = true,
  pending = false,
  initialFocus,
}) {
  return (
    <DSModal
      open={isOpen}
      onClose={onClose}
      title={title}
      footer={footer}
      size={size}
      closeOnOverlay={closeOnOverlay}
      closeOnEscape={closeOnEscape}
      pending={pending}
      initialFocus={initialFocus}
      surfaceClassName={className}
    >
      {children}
    </DSModal>
  );
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  loading = false,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      pending={loading}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={loading} className="min-h-11 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus disabled:pointer-events-none disabled:opacity-50">
            {cancelText}
          </button>
          <button type="button" onClick={onConfirm} disabled={loading} className={`min-h-11 rounded-dd px-3.5 text-[13px] font-medium outline-none transition-colors focus-visible:shadow-dd-focus disabled:pointer-events-none disabled:opacity-50 ${CONFIRM_TONES[variant] ?? CONFIRM_TONES.danger}`}>
            {loading ? <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px] leading-none align-middle">progress_activity</span> : null} {confirmText}
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-dd-muted">{message}</p>
    </Modal>
  );
}
