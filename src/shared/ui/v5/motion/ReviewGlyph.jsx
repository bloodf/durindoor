import { Children, isValidElement } from "react";
import MotionIcon from "./MotionIcon.jsx";

/** Preserve the native span, utility sizing and event handlers around the animated glyph. */
export default function ReviewGlyph({ children, ...props }) {
  const review = globalThis.document?.documentElement.dataset.v5Review === "true";
  // Existing controls accept React artwork as well as string ligatures.
  // Keep provider identity rather than coercing its node into a fallback glyph.
  if (review && Children.toArray(children).some(isValidElement)) return <span {...props} className={props.className?.replace(/\bmaterial-symbols-outlined\b/g, "v5-review-icon-artwork")} data-v5-review-glyph>{children}</span>;
  const glyph = props["data-icon-name"] || (Array.isArray(children) ? children.join("").trim() : String(children || "").trim());
  if (!review) return <span {...props}>{children}</span>;
  return <span {...props} data-v5-review-glyph>
    <MotionIcon name={glyph} size="1em" />
  </span>;
}
