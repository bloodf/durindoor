import { useEffect, useId } from "react";

/**
 * Durin DS — Modal.
 *
 * Centered dialog rendered over a dimmed, blurred backdrop. Replaces the
 * app's ad-hoc modals (and their macOS traffic-light dots — intentionally
 * NOT reproduced here) with a single Durin-styled surface.
 *
 * Behavior contract:
 * - `open=false` renders nothing (children unmount, so any local state in
 *   the dialog content resets naturally between opens).
 * - Esc key and backdrop click both call `onClose`.
 * - Body scroll is locked while the modal is open.
 * - Entry animation reuses `.fade-in` / `.slide-in-top` from
 *   `@/app/globals.css` (defined under "Animations").
 *
 * Styling uses only `*-dd-*` token utilities; class names are full literals
 * (size lookup table below) so the Tailwind v4 scanner can see them.
 */

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  footer,
  children,
}) {
  const titleId = useId();

  // Esc closes while open.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Lock body scroll while open, restoring the previous value on cleanup.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop — separate element behind the panel, so panel clicks never reach it. */}
      <div
        aria-hidden="true"
        className="fade-in absolute inset-0 bg-dd-backdrop backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`fade-in slide-in-top relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface shadow-dd-elevated ${SIZES[size] ?? SIZES.md}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-dd-border-subtle px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={titleId} className="text-base font-semibold text-dd-text">
              {title}
            </h2>
            {subtitle ? <p className="text-xs text-dd-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-dd-text">
          {children}
        </div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-dd-border-subtle px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
