"use client";

import Input from "@/shared/ui/components/Input.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      <Badge tone={badge === "CF" || badge === "TS" ? "accent" : "neutral"} size="sm" className="w-fit shrink-0 sm:min-w-[88px] sm:justify-center">
        {label}
      </Badge>
      <Input value={url} readOnly aria-label={`${label} endpoint`} className="min-w-0 flex-1 font-mono text-xs" />
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
