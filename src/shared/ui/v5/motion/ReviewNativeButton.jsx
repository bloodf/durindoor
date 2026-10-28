import { Children, isValidElement } from "react";
import MotionIcon from "./MotionIcon.jsx";
import { actionIcon } from "./iconHelp.js";

function childText(children) {
  return Children.toArray(children).map((child) => isValidElement(child) ? childText(child.props.children) : String(child)).join(" ").trim();
}

function hasIcon(children) {
  return Children.toArray(children).some((child) => {
    if (!isValidElement(child)) return false;
    const name = child.type.displayName || child.type.name || String(child.type);
    return /^(svg|img)$/.test(name) || /Icon|Logo|Loading|Spinner/.test(name) || /material-symbols|v5-motion-icon/.test(child.props.className || "") || hasIcon(child.props.children);
  });
}

/** Add action glyphs without wrapping the native control or changing its contract.
 * Tabs, listbox choices, switches and pagination numbers retain their own UI. */
export function inferredButtonIcon(children, props = {}) {
  if (props.icon || props.iconTrailing || props.iconRight || props.loading || props["aria-busy"] || hasIcon(children)) return null;
  if (props.role && props.role !== "button") return null;
  return actionIcon(childText(children) || props["aria-label"] || props.title || "");
}

export function allowsIconTooltip(children) {
  const entries = Children.toArray(children);
  return !entries.some((child) => {
    if (!isValidElement(child)) return false;
    const name = child.type.displayName || child.type.name || String(child.type);
    const icon = child.props.icon || child.props.name || (/button$/i.test(name) ? inferredButtonIcon(child.props.children, child.props) : null);
    if (["close", "cancel", "save", "save_as", "save_alt"].includes(icon)) return true;
    if (/^(?:close|save)(?:\s|$)/i.test(child.props["aria-label"] || child.props.label || "")) return true;
    if (/material-symbols/.test(child.props.className || "") && ["close", "save", "save_as"].includes(childText(child.props.children))) return true;
    return !allowsIconTooltip(child.props.children);
  });
}

export default function ReviewNativeButton({ children, className = "", ...props }) {
  const icon = globalThis.document?.documentElement.dataset.v5Review === "true" ? inferredButtonIcon(children, props) : null;
  return <button {...props} className={icon ? `${className} v5-button-with-icon` : className}>
    {icon && <MotionIcon name={icon} />}{children}
  </button>;
}
