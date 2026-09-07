"use client";

import { cn } from "@/shared/utils/cn";

const SIZE_CLASSES = {
  xs: "size-6 text-xs",
  sm: "size-8 text-sm",
  md: "size-10 text-base",
  lg: "size-12 text-lg",
  xl: "size-16 text-xl",
};

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function Avatar({ src, alt = "Avatar", name, size = "md", className }) {
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const frameClass = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-dd-border bg-dd-surface-2 text-dd-accent font-semibold",
    sizeClass,
    className
  );

  if (src) {
    return (
      <span
        className={cn(frameClass, "bg-cover bg-center bg-no-repeat")}
        style={{ backgroundImage: `url(${src})` }}
        role="img"
        aria-label={alt}
      />
    );
  }

  return (
    <span className={frameClass} role="img" aria-label={alt}>
      {getInitials(name)}
    </span>
  );
}
