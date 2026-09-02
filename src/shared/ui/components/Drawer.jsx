import { useEffect, useId } from "react";

/**
 * Durin DS — Drawer.
 *
 * Right-edge panel sliding in over the same dimmed/blurred backdrop as
 * {@link Modal}. Suited to secondary workflows (edit forms, detail panes)
 * that should not take over the whole viewport.
 *
 * Behavior contract mirrors Modal: `open=false` renders null, Esc and
 * backdrop click call `onClose`, body scroll locks while open. The entry
 * animation reuses `.slide-in-right` (panel) and `.fade-in` (backdrop) from
 * `@/app/globals.css`.
 *
 * `width` is applied as an inline style (number → px, or any CSS length) and
 * clamped by `max-w-full` so narrow viewports never overflow.
 */
export default function Drawer({ open, onClose, title, width = 420, footer, children }) {
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
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        className="fade-in absolute inset-0 bg-dd-backdrop backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width }}
        className="slide-in-right absolute inset-y-0 right-0 flex h-full max-w-full flex-col border-l border-dd-border bg-dd-surface shadow-dd-elevated"
      >
        <div className="flex items-center justify-between gap-4 border-b border-dd-border-subtle px-5 py-4">
          <h2 id={titleId} className="min-w-0 truncate text-base font-semibold text-dd-text">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
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
