import MotionIcon from "./MotionIcon.jsx";

/** Preserve the native span, utility sizing and event handlers around the animated glyph. */
export default function ReviewGlyph({ children, ...props }) {
  const review = globalThis.document?.documentElement.dataset.v5Review === "true";
  const glyph = props["data-icon-name"] || (Array.isArray(children) ? children.join("").trim() : String(children || "").trim());
  if (!review) return <span {...props}>{children}</span>;
  return <span {...props} data-v5-review-glyph>
    <MotionIcon name={glyph} size="1em" />
  </span>;
}
