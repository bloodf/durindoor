"use client";

import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";

export default function ThemeToggle({ className, variant = "default" }) {
  const { isDark, toggleTheme } = useTheme();

  const variants = {
    default: cn(
      "flex items-center justify-center size-10 rounded-dd-lg",
      "text-dd-muted hover:text-dd-text",
      "hover:bg-dd-surface-2 transition-colors"
    ),
    card: cn(
      "flex items-center justify-center size-11 rounded-dd-lg",
      "bg-dd-surface hover:bg-dd-surface",
      "border border-dd-border",
      "backdrop-blur-md shadow-dd-elevated hover:shadow-dd-elevated",
      "text-dd-muted hover:text-dd-accent",
      "transition-all group"
    ),
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(variants[variant], className)}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <span
        aria-hidden="true"
        className={cn(
          "material-symbols-outlined text-[22px]",
          variant === "card" && "transition-transform duration-300 group-hover:rotate-12"
        )}
      >
        {isDark ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}
