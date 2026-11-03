import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { explainIcon, ICON_SELECTOR } from "./iconHelp.js";

const CONTROL = 'button,a,input,select,textarea,[role="button"],[role="option"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"]';
const GAP = 8;

/** One top-layer tooltip describes incumbent icons without inserting layout wrappers.
 * The review owns temporary metadata only; teardown restores every authored attribute. */
export default function ReviewIconHelp() {
  const id = useId();
  const popup = useRef(null);
  const [active, setActive] = useState(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });

  useEffect(() => {
    if (document.documentElement.dataset.v5Review !== "true") return undefined;
    const originals = new Map();
    const lastWrites = new Map();
    let pointer = null, focused = null, popupHovered = false, dismissed = false;
    let keyboardInteraction = true;
    let dismissedOwner;
    let hideTimer, touchTimer, frame;
    let described;

    const remember = (element, attribute) => {
      if (!originals.has(element)) originals.set(element, new Map());
      const attrs = originals.get(element);
      if (lastWrites.get(element)?.has(attribute) && element.getAttribute(attribute) !== lastWrites.get(element).get(attribute)) attrs.set(attribute, element.getAttribute(attribute));
      if (!attrs.has(attribute)) attrs.set(attribute, element.getAttribute(attribute));
    };
    const write = (element, attribute, value) => {
      remember(element, attribute);
      if (!lastWrites.has(element)) lastWrites.set(element, new Map());
      lastWrites.get(element).set(attribute, value);
      if (element.getAttribute(attribute) === value) return;
      if (value === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, value);
    };
    const restoreMetadata = (element) => {
      const attrs = originals.get(element);
      if (!attrs) return;
      for (const attribute of ["data-v5-icon-help", "data-v5-icon-generated-label", "tabindex", "role", "aria-label", "aria-hidden"]) {
        if (!attrs.has(attribute)) continue;
        const value = attrs.get(attribute);
        if (element.getAttribute(attribute) === lastWrites.get(element)?.get(attribute)) {
          if (value === null) element.removeAttribute(attribute);
          else element.setAttribute(attribute, value);
        }
        attrs.delete(attribute);
        lastWrites.get(element)?.delete(attribute);
      }
    };
    const canonical = (element) => element.closest('.v5-motion-icon') || element.querySelector('.v5-motion-icon') || element.closest('[role="img"][aria-label]') || element;
    const existingTooltip = (element) => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        if ((node.getAttribute("aria-describedby") || "").split(/\s+/).some((ref) => ref !== id && document.getElementById(ref)?.getAttribute("role") === "tooltip")) return true;
      }
      return false;
    };
    const info = (target, keyboard = false) => {
      if (!(target instanceof Element) || target.closest('[role="tooltip"]')) return null;
      let icon = target.closest(ICON_SELECTOR);
      const control = target.closest(CONTROL);
      if (!icon && keyboard && control) icon = control.querySelector(ICON_SELECTOR);
      // Inputs own their prefix/suffix icons through the enclosing field box.
      if (!icon && keyboard && target.matches("input,select,textarea")) icon = target.parentElement?.querySelector(ICON_SELECTOR);
      if (!icon) return null;
      icon = canonical(icon);
      const text = explainIcon(icon);
      if (!text || existingTooltip(icon)) return null;
      const anchor = keyboard && control ? control : icon;
      return { icon, anchor, owner: control || anchor, text };
    };
    const clearDescription = () => {
      if (!described) return;
      const refs = (described.getAttribute("aria-describedby") || "").split(/\s+/).filter((ref) => ref && ref !== id);
      if (refs.length) described.setAttribute("aria-describedby", refs.join(" "));
      else described.removeAttribute("aria-describedby");
      described = null;
    };
    const show = () => {
      clearTimeout(hideTimer);
      const next = pointer || focused;
      if (next && dismissed && next.owner !== dismissedOwner) dismissed = false;
      if (next && !dismissed && next.anchor.isConnected) {
        clearDescription();
        described = next.owner;
        const refs = new Set((described.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
        refs.add(id);
        described.setAttribute("aria-describedby", [...refs].join(" "));
        setActive(next);
      } else if (!popupHovered || dismissed) {
        hideTimer = setTimeout(() => { clearDescription(); setActive(null); }, dismissed ? 0 : 120);
      }
      if (!pointer && !focused && !popupHovered) dismissed = false;
    };
    const annotate = () => {
      const seen = new Set();
      for (const candidate of document.querySelectorAll(ICON_SELECTOR)) {
        if (candidate.closest('[role="tooltip"]')) continue;
        const icon = canonical(candidate);
        if (seen.has(icon)) continue;
        seen.add(icon);
        // A new authored accessible name takes ownership from our temporary label.
        if (icon.hasAttribute("data-v5-icon-generated-label") && icon.getAttribute("aria-label") !== lastWrites.get(icon)?.get("aria-label")) {
          write(icon, "data-v5-icon-generated-label", null);
          originals.get(icon)?.delete("aria-label");
          lastWrites.get(icon)?.delete("aria-label");
        }
        const text = explainIcon(icon);
        if (!text) { restoreMetadata(icon); continue; }
        write(icon, "data-v5-icon-help", text);
        // Every standalone informational icon also exposes its explanation by keyboard.
        if (!icon.closest(CONTROL) && !icon.parentElement?.closest('[aria-hidden="true"]')) {
          if (!icon.hasAttribute("tabindex")) write(icon, "tabindex", "0");
          if (icon.getAttribute("aria-hidden") === "true") write(icon, "aria-hidden", null);
          if (!icon.hasAttribute("role")) write(icon, "role", "img");
          if (!icon.hasAttribute("aria-label") || originals.get(icon)?.has("aria-label")) {
            write(icon, "data-v5-icon-generated-label", "true");
            write(icon, "aria-label", text);
          }
        }
      }
      // Native titles otherwise produce a second, browser-styled tooltip, including exceptions.
      for (const icon of seen) {
        for (let node = icon; node && node !== document.body; node = node.parentElement) {
          if (node.hasAttribute("title")) {
            write(node, "data-v5-icon-title", node.getAttribute("title"));
            write(node, "title", null);
          }
          if (node.matches(CONTROL)) break;
        }
      }
      const next = pointer || focused;
      if (next && !next.anchor.isConnected) { pointer = null; focused = null; popupHovered = false; show(); }
      else if (next) {
        const updated = explainIcon(next.icon);
        if (updated !== next.text) {
          pointer = pointer ? info(pointer.icon) : null;
          focused = focused ? info(focused.owner, true) : null;
          show();
        }
      }
    };
    const over = (event) => {
      if (popup.current?.contains(event.target)) { popupHovered = true; show(); return; }
      pointer = info(event.target);
      show();
    };
    const out = (event) => {
      if (popup.current?.contains(event.relatedTarget)) { popupHovered = true; show(); return; }
      popupHovered = false;
      pointer = info(event.relatedTarget);
      show();
    };
    const focusIn = (event) => { focused = keyboardInteraction ? info(event.target, true) : null; show(); };
    const focusOut = (event) => { focused = keyboardInteraction ? info(event.relatedTarget, true) : null; show(); };
    const focusField = (event) => {
      if (!(event.target instanceof Element)) return;
      const icon = event.target.closest(ICON_SELECTOR);
      const prefix = icon?.closest(".pointer-events-none");
      const input = prefix?.parentElement?.querySelector("input,textarea");
      if (input && !input.disabled && !event.target.closest("button,a")) input.focus();
    };
    const touch = (event) => {
      keyboardInteraction = false;
      focused = null;
      pointer = info(event.target);
      show();
      if (event.pointerType !== "touch") return;
      dismissed = false;
      pointer = info(event.target);
      show();
      clearTimeout(touchTimer);
      touchTimer = setTimeout(() => { pointer = null; show(); }, 2500);
    };
    const escape = (event) => {
      if (event.key !== "Escape") { keyboardInteraction = true; return; }
      if (event.key !== "Escape" || dismissed || !(pointer || focused)) return;
      // An open listbox owns Escape so choosing an option keeps its native workflow.
      const openListbox = event.target instanceof Element && event.target.closest('[role="combobox"][aria-expanded="true"],[role="listbox"]');
      if (!openListbox) { event.preventDefault(); event.stopPropagation(); }
      dismissed = true;
      dismissedOwner = (pointer || focused).owner;
      popupHovered = false;
      show();
    };
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = null; annotate(); });
    });
    annotate();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["data-icon-name", "aria-label", "aria-pressed", "aria-expanded", "title", "src", "alt"] });
    const events = { pointerover: over, pointerout: out, focusin: focusIn, focusout: focusOut, pointerdown: touch, click: focusField };
    document.addEventListener("keydown", escape, true);
    for (const [name, handler] of Object.entries(events)) document.addEventListener(name, handler);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(hideTimer); clearTimeout(touchTimer);
      for (const [name, handler] of Object.entries(events)) document.removeEventListener(name, handler);
      document.removeEventListener("keydown", escape, true);
      clearDescription();
      for (const [element, attrs] of originals) for (const [attribute, value] of attrs) {
        if (element.getAttribute(attribute) !== lastWrites.get(element)?.get(attribute)) continue;
        if (value === null) element.removeAttribute(attribute);
        else element.setAttribute(attribute, value);
      }
    };
  }, [id]);

  useLayoutEffect(() => {
    const element = popup.current;
    if (!element) return undefined;
    const supportsPopover = "showPopover" in element;
    if (!active) {
      if (supportsPopover && element.matches(":popover-open")) element.hidePopover();
      return undefined;
    }
    if (supportsPopover && !element.matches(":popover-open")) element.showPopover();
    const place = () => {
      const anchor = active.anchor.getBoundingClientRect(), bounds = element.getBoundingClientRect();
      const left = Math.max(GAP, Math.min(anchor.left + anchor.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - GAP));
      const above = anchor.top - bounds.height - GAP;
      const top = Math.max(GAP, Math.min(above >= GAP ? above : anchor.bottom + GAP, window.innerHeight - bounds.height - GAP));
      setPosition({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [active]);

  return createPortal(<span ref={popup} id={id} role={active ? "tooltip" : undefined} popover="manual" data-v5-icon-tooltip
    className="v5-icon-tooltip" style={{ left: position.left, top: position.top, visibility: active ? "visible" : "hidden" }}>
    {active?.text || ""}
  </span>, document.body);
}
