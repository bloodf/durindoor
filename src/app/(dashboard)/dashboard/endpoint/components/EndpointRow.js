"use client";

import IconButton from "@/shared/ui/components/IconButton.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";

/**
 * Reusable endpoint row component.
 *
 * The URL is rendered as wrapping text rather than a single-line readonly
 * <input>: an input clips anything past its width with no affordance, so a
 * tunnel or Tailscale hostname read as a truncated fragment
 * ("https://tim-rpg-phili") even though the full value was present and
 * copyable. Wrapping shows the whole URL at every width.
 */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
      <Badge tone={badge === "CF" || badge === "TS" ? "accent" : "neutral"} size="sm" className="w-fit shrink-0 sm:mt-1.5 sm:min-w-[88px] sm:justify-center">
        {label}
      </Badge>
      <span
        className="min-w-0 flex-1 select-all break-all rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-2 py-1.5 font-mono text-xs text-dd-text"
        aria-label={`${label} endpoint`}
      >
        {url}
      </span>
      <IconButton
        icon={copied === copyId ? "check" : "content_copy"}
        label={`Copy ${label} endpoint`}
        onClick={() => onCopy(url, copyId)}
        variant="ghost"
        size="md"
      />
      {actions}
    </div>
  );
}
