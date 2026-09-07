"use client";

import DSDrawer from "@/shared/ui/components/Drawer.jsx";

const WIDTH_PX = { sm: 400, md: 500, lg: 600, xl: 800 };

/**
 * Legacy `{ isOpen, width: "sm"|"md"|"lg"|"xl"|"full" }` API composed over
 * the authoritative Durin DS `Drawer` (built on DS `Modal`'s native dialog).
 * DS supplies a numeric-or-CSS `width` to its drawer surface; `full` maps to
 * `"100%"` so the inline width style wins over the primitive's default 420px.
 */
export default function Drawer({ isOpen, onClose, title, children, width = "md", className }) {
  const isFull = width === "full";
  return (
    <DSDrawer
      open={isOpen}
      onClose={onClose}
      title={title}
      width={isFull ? "100%" : WIDTH_PX[width] ?? 500}
      className={className}
    >
      {children}
    </DSDrawer>
  );
}
