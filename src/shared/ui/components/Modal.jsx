import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { isFunction, isObject, isString } from "@/shared/utils/typeChecks";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[95vw]",
};

const FOCUSABLE_SELECTOR =
  "button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

function isElementFocusable(element, requireTabStop = true) {
  if (!(element instanceof HTMLElement)) return false;
  // Skip elements that are hidden, inert, disabled, or out of view.
  if (isFunction(element.checkVisibility) && !element.checkVisibility({ checkOpacity: false })) return false;
  if (element.hidden || element.matches(":disabled") || element.closest("[hidden]") || element.closest("[inert]")) return false;
  if (requireTabStop && element.tabIndex < 0) return false;
  const style = window.getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none") return false;
  // display:none / visibility:hidden ancestors can still leave the element
  // with checkVisibility=true in some engines; walk parents to catch the rest.
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLElement) {
      const ancestorStyle = window.getComputedStyle(ancestor);
      if (ancestorStyle.display === "none" || ancestorStyle.visibility === "hidden") return false;
    }
  }
  return true;
}

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => isElementFocusable(element));
}

// React synthetic keydown events bubble from inner DOM up to every dialog
// instance whose `<dialog>` root contains the source. The most recently
// opened dialog wins so nested dialogs and portal-rendered controls (Select
// listbox) inside an outer dialog still fall under the outer's trap.
const openDialogStack = [];
function pushDialog(dialog) { if (dialog) openDialogStack.push(dialog); }
function popDialog(dialog) {
  const index = openDialogStack.lastIndexOf(dialog);
  if (index >= 0) openDialogStack.splice(index, 1);
}
function topmostDialog() {
  return openDialogStack.length > 0 ? openDialogStack[openDialogStack.length - 1] : null;
}

let scrollLocks = 0;
let savedOverflow = "";

function lockScroll() {
  if (scrollLocks++ === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}

function unlockScroll() {
  if (scrollLocks > 0 && --scrollLocks === 0) document.body.style.overflow = savedOverflow;
}
/**
 * Native top-layer dialog with controlled open state.
 *
 * `closeOnOverlay`, `closeOnEscape`, and `pending` default to legacy dismissible
 * behavior. `initialFocus` accepts a ref or selector. Closed content unmounts.
 *
 * Focus trap: native `showModal()` already inerts the rest of the document, so
 * the only escape left is Tab leaving the dialog through its first or last
 * control. We wrap forward and backward Tab at those visible-enabled
 * boundaries and bail to the dialog when no descendants are focusable. Nested
 * dialogs and portal-rendered listboxes (e.g. Select) inside an outer dialog
 * still fall under the outer's trap because the dialog instance is the
 * topmost entry on the module-level stack.
 */
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  footer,
  children,
  className = "",
  surfaceClassName = "",
  closeOnOverlay = true,
  closeOnEscape = true,
  pending = false,
  showClose = true,
  initialFocus,
  layout = "modal",
  width,
}) {
  const dialogRef = useRef(null);
  const openerRef = useRef(null);
  const backdropPointerRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const dismissible = !pending;
  const drawer = layout === "drawer";

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    let locked = false;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      if (!dialog.open) dialog.showModal();
      pushDialog(dialog);
      lockScroll();
      locked = true;
      let requestedTarget = null;
      if (isObject(initialFocus) && initialFocus && "current" in initialFocus) {
        requestedTarget = initialFocus.current;
      } else if (isString(initialFocus)) {
        try { requestedTarget = dialog.querySelector(initialFocus); } catch { requestedTarget = null; }
      }
      const autofocus = dialog.querySelector("[autofocus]");
      const target = requestedTarget instanceof HTMLElement && requestedTarget.isConnected && dialog.contains(requestedTarget) && isElementFocusable(requestedTarget, false)
        ? requestedTarget
        : autofocus instanceof HTMLElement && isElementFocusable(autofocus)
          ? autofocus
          : getFocusableElements(dialog)[0] ?? dialog;
      target.focus();
    } catch (error) {
      if (locked) unlockScroll();
      popDialog(dialog);
      if (dialog.open) dialog.close();
      throw error;
    }
    return () => {
      if (locked) unlockScroll();
      popDialog(dialog);
      if (dialog.open) dialog.close();
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [open, initialFocus]);

  const handleKeyDown = (event) => {
    const dialog = dialogRef.current;
    if (event.key !== "Tab" || topmostDialog() !== dialog) return;
    const sourceDialog = event.target.closest("dialog");
    if (sourceDialog && sourceDialog !== dialog) return;
    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const inside = dialog.contains(active);
    if (event.shiftKey) {
      if (!inside || !focusable.includes(active) || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!inside || !focusable.includes(active) || active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  if (!open) return null;

  const requestClose = () => {
    if (dismissible) onClose?.();
  };
  const handleCancel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (topmostDialog() !== dialogRef.current) return;
    if (closeOnEscape) requestClose();
  };
  const handlePointerDown = (event) => {
    backdropPointerRef.current = event.target === event.currentTarget;
  };
  const handlePointerUp = (event) => {
    if (backdropPointerRef.current && event.target === event.currentTarget && closeOnOverlay) requestClose();
    backdropPointerRef.current = false;
  };
  const surfaceClass = drawer
    ? "slide-in-right flex h-full max-w-full flex-col border-s border-dd-border bg-dd-surface shadow-dd-elevated motion-reduce:animate-none"
    : `fade-in slide-in-top flex max-h-[85vh] w-full flex-col overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface shadow-dd-elevated motion-reduce:animate-none ${SIZES[size] ?? SIZES.md}`;
  const dialogClass = drawer
    ? "fixed inset-0 m-0 flex h-full w-full max-w-none items-stretch justify-end overflow-hidden border-0 bg-transparent p-0 backdrop:bg-dd-backdrop backdrop:backdrop-blur-sm rtl:justify-start [&:not([open])]:hidden"
    : "fixed inset-0 m-0 flex h-full w-full max-w-none items-center justify-center overflow-hidden border-0 bg-transparent p-4 backdrop:bg-dd-backdrop backdrop:backdrop-blur-sm [&:not([open])]:hidden";

  return createPortal(
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={subtitle ? descriptionId : undefined}
      className={`${dialogClass} ${className}`}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <section
        role="document"
        style={drawer ? { width } : undefined}
        className={`${surfaceClass} ${surfaceClassName}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-dd-border-subtle px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? <h2 id={titleId} className="text-base font-semibold text-dd-text">{title}</h2> : null}
            {subtitle ? <p id={descriptionId} className="text-xs text-dd-muted">{subtitle}</p> : null}
          </div>
          {showClose ? (
          <button
            type="button"
            aria-label="Close"
            disabled={!dismissible}
            onClick={requestClose}
            className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px] leading-none">close</span>
          </button>
          ) : null}
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-dd-text">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-dd-border-subtle px-5 py-3.5">{footer}</footer> : null}
      </section>
    </dialog>,
    document.body,
  );
}
