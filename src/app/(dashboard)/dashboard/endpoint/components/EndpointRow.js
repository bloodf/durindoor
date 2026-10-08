"use client";

import { useLayoutEffect, useRef } from "react";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";

/**
 * Native read-only selection with wrapping and automatic height. Re-measure
 * on value and width changes so long endpoint URLs stay fully visible.
 */
export function EndpointValue({ label, url, className = "rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-2 py-1.5 text-dd-text" }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const field = ref.current;
    let width = field.clientWidth;
    const resize = () => {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
    };
    resize();
    document.fonts.addEventListener("loadingdone", resize);
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      resize();
    });
    observer.observe(field);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", resize);
    };
  }, [url]);

  return (
    <textarea
      ref={ref}
      aria-label={label}
      readOnly
      rows={1}
      wrap="soft"
      value={url}
      className={`min-h-11 min-w-0 w-full flex-1 self-start resize-none overflow-hidden whitespace-pre-wrap break-all font-mono text-xs outline-none focus-visible:shadow-dd-focus ${className}`}
    />
  );
}

/** Endpoint value and copy action share the same complete URL. */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
      <Badge tone={badge === "CF" || badge === "TS" ? "accent" : "neutral"} size="sm" className="w-fit shrink-0 sm:mt-1.5 sm:min-w-[88px] sm:justify-center">
        {label}
      </Badge>
      <EndpointValue label={`${label} endpoint`} url={url} />
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
