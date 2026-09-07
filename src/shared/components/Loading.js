"use client";

import { cn } from "@/shared/utils/cn";

const SIZE_CLASSES = {
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
  xl: "size-12",
};

export function Spinner({ size = "md", className, label = "Loading", role, ...props }) {
  const hidden = props["aria-hidden"] === true || props["aria-hidden"] === "true";
  return (
    <span
      role={hidden ? undefined : role || "status"}
      aria-label={hidden ? undefined : label}
      className={cn("material-symbols-outlined animate-spin text-dd-accent motion-reduce:animate-none", SIZE_CLASSES[size] || SIZE_CLASSES.md, className)}
      {...props}
    >
      progress_activity
    </span>
  );
}

export function PageLoading({ message = "Loading..." }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-dd-bg px-4 text-center" role="status" aria-live="polite">
      <Spinner aria-hidden="true" size="xl" label={message} />
      <p className="mt-4 text-[13px] text-dd-muted">{message}</p>
    </div>
  );
}

export function Skeleton({ className, ...props }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-dd bg-dd-surface-2 motion-reduce:animate-none", className)} {...props} />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-dd-lg border border-dd-border bg-dd-surface p-6" role="status" aria-label="Loading card">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-10" />
      </div>
      <Skeleton className="mb-2 h-8 w-16" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export default function Loading({ type = "spinner", ...props }) {
  switch (type) {
    case "page":
      return <PageLoading {...props} />;
    case "skeleton":
      return <Skeleton {...props} />;
    case "card":
      return <CardSkeleton {...props} />;
    default:
      return <Spinner {...props} />;
  }
}
