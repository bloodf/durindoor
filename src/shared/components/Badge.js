"use client";

import { cn } from "@/shared/utils/cn";

const VARIANT_CLASSES = {
  default: "border border-dd-border bg-dd-surface-2 text-dd-muted",
  primary: "bg-dd-accent-soft text-dd-accent",
  success: "bg-dd-success/10 text-dd-success",
  warning: "bg-dd-warning/10 text-dd-warning",
  error: "bg-dd-danger/10 text-dd-danger",
  info: "bg-dd-info/10 text-dd-info",
};

const DOT_CLASSES = {
  default: "bg-dd-muted",
  primary: "bg-dd-accent",
  success: "bg-dd-success",
  warning: "bg-dd-warning",
  error: "bg-dd-danger",
  info: "bg-dd-info",
};

const SIZE_CLASSES = {
  sm: "gap-1 px-1.5 py-0.5 text-[11px]",
  md: "gap-1.5 px-2 py-1 text-xs",
  lg: "gap-1.5 px-3 py-1.5 text-sm",
};

const ICON_CLASSES = {
  sm: "text-[12px]",
  md: "text-[14px]",
  lg: "text-[16px]",
};

export default function Badge({
  children,
  variant = "default",
  size = "md",
  dot = false,
  icon,
  className,
  ...props
}) {
  const resolvedVariant = VARIANT_CLASSES[variant] ? variant : "default";
  const resolvedSize = SIZE_CLASSES[size] ? size : "md";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium whitespace-nowrap",
        VARIANT_CLASSES[resolvedVariant],
        SIZE_CLASSES[resolvedSize],
        className
      )}
      {...props}
    >
      {dot && <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASSES[resolvedVariant])} />}
      {icon && (
        <span aria-hidden="true" className={cn("material-symbols-outlined leading-none", ICON_CLASSES[resolvedSize])}>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
