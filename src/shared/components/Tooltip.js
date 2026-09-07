"use client";

import { cloneElement, isValidElement } from "react";
import DSTooltip from "@/shared/ui/components/Tooltip.jsx";
import { isString } from "@/shared/utils/typeChecks";

const FOCUSABLE_TAGS = new Set(["a", "button", "input", "select", "textarea"]);

/**
 * Legacy tooltip API. Non-focusable icon spans become keyboard-reachable
 * triggers, preserving visual child output while making their description
 * available to keyboard users. Arbitrary `color` is retired for DS tokens.
 */
export default function Tooltip({ text, children, position = "top", color: _color }) {
  const child = isValidElement(children) && isString(children.type) && !FOCUSABLE_TAGS.has(children.type) && children.props.tabIndex === undefined
    ? cloneElement(children, { tabIndex: 0, role: children.props.role ?? "img", "aria-label": children.props["aria-label"] ?? text })
    : children;
  return <DSTooltip content={text} side={position}>{child}</DSTooltip>;
}
