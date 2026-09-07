"use client";

import { CAPACITY_META } from "@/shared/constants/models";
import Tooltip from "@/shared/ui/components/Tooltip.jsx";
import { cn } from "@/shared/utils/cn";

const CAPACITY_CLASSES = {
  vision: "text-dd-info",
  reasoning: "text-dd-warning",
  tools: "text-dd-accent-2",
};

// Pre-existing callers (e.g. providers/[id]/ModelRow.js) pass a raw Tailwind
// utility as colorOverride. Map known legacy values to the matching dd-*
// token first; arbitrary caller-supplied classes are passed through
// unchanged so the documented public API is preserved.
const LEGACY_COLOR_OVERRIDES = {
  "text-text-muted/70": "text-dd-muted",
};

function resolveColorClass(colorOverride, key) {
  if (!colorOverride) return CAPACITY_CLASSES[key] || "text-dd-muted";
  return LEGACY_COLOR_OVERRIDES[colorOverride] || colorOverride;
}

// Render small icon badges for capabilities that are explicitly enabled.
export default function CapacityBadges({ caps, className = "", colorOverride, size = 16 }) {
  if (!caps) return null;
  const active = Object.keys(CAPACITY_META).filter((key) => caps[key]);
  if (active.length === 0) return null;

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {active.map((key) => {
        const capability = CAPACITY_META[key];
        const label = `${capability.label} — ${capability.desc}`;
        return (
          <Tooltip key={key} content={label}>
            <span
              tabIndex={0}
              role="img"
              aria-label={label}
              className={cn(
                "-m-2.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-dd p-2.5 outline-none focus-visible:shadow-dd-focus",
                resolveColorClass(colorOverride, key)
              )}
            >
              <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: `${size}px` }}>
                {capability.icon}
              </span>
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}
