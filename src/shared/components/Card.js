"use client";

import { cn } from "@/shared/utils/cn";

const PADDING_CLASSES = {
  none: "",
  xs: "p-3",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev = false,
  className,
  ...props
}) {
  return (
    <div
      className={cn(
        "rounded-dd-lg border border-dd-border bg-dd-surface",
        elev && "shadow-dd-elevated",
        hover && "cursor-pointer transition-colors hover:border-dd-accent focus-within:border-dd-accent",
        PADDING_CLASSES[padding] ?? PADDING_CLASSES.md,
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
                <span aria-hidden="true" className="material-symbols-outlined text-[20px] leading-none">{icon}</span>
              </span>
            )}
            <div className="min-w-0">
              {title && <h3 className="truncate text-sm font-semibold text-dd-text">{title}</h3>}
              {subtitle && <p className="mt-0.5 text-xs text-dd-muted">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

Card.Section = function CardSection({ children, className, ...props }) {
  return (
    <div className={cn("rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-4", className)} {...props}>
      {children}
    </div>
  );
};

Card.Row = function CardRow({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "-mx-3 border-b border-dd-border-subtle px-3 py-3 text-[13px] text-dd-text last:border-b-0 transition-colors hover:bg-dd-surface-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({ children, actions, className, ...props }) {
  return (
    <div
      className={cn(
        "group -mx-3 flex items-center justify-between gap-3 border-b border-dd-border-subtle px-3 py-3 text-[13px] text-dd-text last:border-b-0 transition-colors hover:bg-dd-surface-2",
        className
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions && (
        <div
          className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
        >
          {actions}
        </div>
      )}
    </div>
  );
};
