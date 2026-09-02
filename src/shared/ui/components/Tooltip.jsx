/**
 * Durin DS — Tooltip.
 *
 * Pure-CSS visibility tooltip: the trigger is wrapped in a `group` span and
 * the bubble appears on `group-hover` / `group-focus-within`, so keyboard
 * users tabbing to a focusable child see it too. No portals, no JS state.
 *
 * Each `side` has a full literal position class in POSITIONS plus a matching
 * arrow in ARROWS (a 45°-rotated square whose two visible borders point away
 * from the bubble; its solid `bg-dd-surface-3` covers the bubble border seam).
 */

const POSITIONS = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

const ARROWS = {
  top: "left-1/2 top-full -translate-x-1/2 -translate-y-1/2 border-b border-r",
  bottom: "bottom-full left-1/2 -translate-x-1/2 translate-y-1/2 border-l border-t",
  left: "left-full top-1/2 -translate-x-1/2 -translate-y-1/2 border-r border-t",
  right: "right-full top-1/2 translate-x-1/2 -translate-y-1/2 border-b border-l",
};

export default function Tooltip({ content, side = "top", children }) {
  if (!content) return children;

  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-dd border border-dd-border bg-dd-surface-3 px-2 py-1 text-xs text-dd-text opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${POSITIONS[side] ?? POSITIONS.top}`}
      >
        {content}
        <span
          aria-hidden="true"
          className={`absolute h-2 w-2 rotate-45 border-dd-border bg-dd-surface-3 ${ARROWS[side] ?? ARROWS.top}`}
        />
      </span>
    </span>
  );
}
