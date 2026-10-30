import AnimateButton from "./AnimateButton.jsx";
import MotionIcon from "./MotionIcon.jsx";
import { inferredButtonIcon } from "./ReviewNativeButton.jsx";

const variants = {
  primary: "bg-dd-accent text-dd-on-accent hover:bg-dd-accent-hover",
  secondary: "bg-dd-surface-2 border border-dd-border text-dd-text hover:bg-dd-surface-3",
  ghost: "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text",
  danger: "bg-dd-danger-action text-dd-on-danger hover:bg-dd-danger-action-hover",
};
const sizes = {
  md: "min-h-11 min-w-11 px-3.5 text-[13px] font-medium",
  sm: "min-h-11 min-w-11 px-2.5 text-[13px] font-medium",
};

/** Review-only Animate UI button, preserving the shared Button contract. */
export default function ReviewButton({ variant = "secondary", size = "md", icon, iconTrailing, loading = false, disabled = false, type = "button", children, className = "", ...rest }) {
  const leadingIcon = icon || inferredButtonIcon(children, { ...rest, iconTrailing, loading });
  return <AnimateButton {...rest} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
    className={`inline-flex items-center justify-center gap-2 rounded-dd outline-none transition-colors focus-visible:shadow-dd-focus disabled:opacity-50 ${variants[variant] || variants.secondary} ${sizes[size] || sizes.md} ${className}`}>
    {loading ? <MotionIcon name="progress_activity" className="motion-safe:animate-spin" /> : leadingIcon ? <MotionIcon name={leadingIcon} /> : null}
    {children}
    {iconTrailing ? <MotionIcon name={iconTrailing} /> : null}
  </AnimateButton>;
}
