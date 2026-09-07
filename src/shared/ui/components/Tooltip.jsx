import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { isBrowser, isFunction, isUndefined } from "../../utils/typeChecks.js";

const GAP = 8;
const HIDE_DELAY = 120;
const TOUCH_DELAY = 2500;

/**
 * Durin DS — Tooltip.
 *
 * Describes one existing, focusable trigger. Where the Popover API is
 * available the bubble is a native `popover="manual"` element shown/hidden
 * imperatively via `showPopover()`/`hidePopover()`, so it renders in the
 * browser top layer — clipped only by the viewport, never by sidebar or
 * scroll-container overflow. Older browsers fall back to plain fixed
 * positioning (still viewport-clamped, just outside the top layer).
 * `aria-describedby` stays on the trigger; the popover is referenced by id.
 * Pointer hover, keyboard focus, popup hover, and touch keep independent
 * presence state so one input leaving cannot hide another input's tooltip.
 * Escape dismisses until every trigger/popup presence ends.
 *
 * @param {object} props
 * @param {React.ReactNode} props.content Short descriptive text.
 * @param {"top"|"bottom"|"left"|"right"} [props.side] Preferred bubble side.
 * @param {React.ReactElement} props.children Existing focusable trigger; its props/handlers are preserved.
 */
export default function Tooltip({ content, side = "top", children }) {
  const id = useId();
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const hideTimer = useRef(null);
  const touchTimer = useRef(null);
  const expectedPopoverState = useRef(null);
  const [triggerHovered, setTriggerHovered] = useState(false);
  const [triggerFocused, setTriggerFocused] = useState(false);
  const [popupHovered, setPopupHovered] = useState(false);
  const [touchActive, setTouchActive] = useState(false);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });

  const hasDom = isBrowser();
  const child = isValidElement(children) ? Children.only(children) : null;
  const present = triggerHovered || triggerFocused || popupHovered || touchActive;
  const supportsPopover =
    hasDom && !isUndefined(globalThis.HTMLElement) &&
    isFunction(globalThis.HTMLElement.prototype.showPopover) &&
    isFunction(globalThis.HTMLElement.prototype.hidePopover);

  useEffect(
    () => () => {
      clearTimeout(hideTimer.current);
      clearTimeout(touchTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!present) setDismissed(false);
  }, [present]);

  useEffect(() => {
    clearTimeout(hideTimer.current);
    if (present && !dismissed) {
      setOpen(true);
      return undefined;
    }
    hideTimer.current = setTimeout(() => setOpen(false), HIDE_DELAY);
    return () => clearTimeout(hideTimer.current);
  }, [dismissed, present]);

  // Reflect `open` onto the native popover; native dismissals keep tooltip
  // dismissed until every input-presence source ends.
  useEffect(() => {
    if (!hasDom || !supportsPopover || !popupRef.current) return undefined;
    const el = popupRef.current;
    const onToggle = (event) => {
      const nowOpen = event.newState ? event.newState === "open" : el.matches(":popover-open");
      const expected = expectedPopoverState.current;
      expectedPopoverState.current = null;
      if (expected === nowOpen) return;
      setOpen(nowOpen);
      if (!nowOpen && present) setDismissed(true);
    };
    el.addEventListener("toggle", onToggle);

    if (el.isConnected) {
      const isShown = el.matches(":popover-open");
      if (open && !isShown) {
        expectedPopoverState.current = true;
        el.showPopover();
      } else if (!open && isShown) {
        expectedPopoverState.current = false;
        el.hidePopover();
      }
    }

    return () => el.removeEventListener("toggle", onToggle);
  }, [hasDom, open, present, supportsPopover]);

  useEffect(() => {
    if (!open || !hasDom) return undefined;
    const dismissOnEscape = (event) => {
      if (event.key === "Escape") {
        clearTimeout(hideTimer.current);
        setOpen(false);
        setDismissed(true);
      }
    };
    globalThis.document.addEventListener("keydown", dismissOnEscape);
    return () => globalThis.document.removeEventListener("keydown", dismissOnEscape);
  }, [hasDom, open]);

  useEffect(() => {
    if (!open || !hasDom) return undefined;

    const place = () => {
      if (!triggerRef.current || !popupRef.current) return;
      const trigger = triggerRef.current.getBoundingClientRect();
      const popup = popupRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const preferred = ["top", "bottom", "left", "right"].includes(side) ? side : "top";
      let resolvedSide = preferred;
      if (preferred === "top" && trigger.top < popup.height + GAP) resolvedSide = "bottom";
      if (preferred === "bottom" && viewportHeight - trigger.bottom < popup.height + GAP) resolvedSide = "top";
      if (preferred === "left" && trigger.left < popup.width + GAP) resolvedSide = "right";
      if (preferred === "right" && viewportWidth - trigger.right < popup.width + GAP) resolvedSide = "left";

      let left = trigger.left + trigger.width / 2 - popup.width / 2;
      let top = resolvedSide === "top" ? trigger.top - popup.height - GAP : trigger.bottom + GAP;
      if (resolvedSide === "left" || resolvedSide === "right") {
        left = resolvedSide === "left" ? trigger.left - popup.width - GAP : trigger.right + GAP;
        top = trigger.top + trigger.height / 2 - popup.height / 2;
      }
      setPosition({
        left: Math.max(GAP, Math.min(left, viewportWidth - popup.width - GAP)),
        top: Math.max(GAP, Math.min(top, viewportHeight - popup.height - GAP)),
      });
    };

    place();
    window.addEventListener("resize", place);
    globalThis.document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      globalThis.document.removeEventListener("scroll", place, true);
    };
  }, [hasDom, open, side]);

  if (!content || !child) return children;

  const describedBy = [child.props["aria-describedby"], id].filter(Boolean).join(" ");
  const trigger = cloneElement(child, {
    "aria-describedby": describedBy,
    onMouseEnter: (event) => {
      setTriggerHovered(true);
      child.props.onMouseEnter?.(event);
    },
    onMouseLeave: (event) => {
      setTriggerHovered(false);
      child.props.onMouseLeave?.(event);
    },
    onFocus: (event) => {
      setTriggerFocused(true);
      child.props.onFocus?.(event);
    },
    onBlur: (event) => {
      setTriggerFocused(false);
      child.props.onBlur?.(event);
    },
  });

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") return;
          setDismissed(false);
          setTouchActive(true);
          clearTimeout(touchTimer.current);
          touchTimer.current = setTimeout(() => setTouchActive(false), TOUCH_DELAY);
        }}
      >
        {trigger}
      </span>
      <span
        ref={popupRef}
        id={id}
        role="tooltip"
        {...(supportsPopover ? { popover: "manual" } : {})}
        onMouseEnter={() => setPopupHovered(true)}
        onMouseLeave={() => setPopupHovered(false)}
        className={`fixed z-[60] max-w-xs rounded-dd border border-dd-border bg-dd-surface-3 px-2 py-1 text-xs text-dd-text shadow-dd-elevated transition-opacity duration-150 motion-reduce:transition-none ${
          open ? "opacity-100" : "pointer-events-none invisible opacity-0"
        }`}
        style={{ left: position.left, top: position.top, margin: 0 }}
      >
        {content}
      </span>
    </>
  );
}
