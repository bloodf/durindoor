import { useRef } from "react";

/**
 * Durin DS — Tabs (underline).
 *
 * Underline tab bar with tablist semantics: `role="tab"` buttons in a
 * `role="tablist"` row, `aria-selected` on the active tab, arrow keys (and
 * Home/End) move and select tabs, and a roving tabindex keeps only the
 * active tab tabbable. The active tab uses the gold `dd-accent` text plus a
 * 2px accent indicator bar that overlaps the row's hairline border —
 * gold marks the current selection because tabs are interactive, not
 * decorative.
 *
 * Optional `count` renders as a neutral pill (`dd-surface-2`, never accent)
 * with tabular figures so lists do not reflow as numbers change.
 *
 * Class names are complete literals in source: Tailwind v4 scans file text
 * for candidates, so interpolated class names would never generate CSS.
 */

const NAV_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];

export default function Tabs({ tabs = [], value, onChange, ...rest }) {
  const listRef = useRef(null);

  const selectTab = (tab, index) => {
    if (tab.disabled) return;
    onChange?.(tab.value);
    // Move focus alongside the selection (automatic-activation tablist).
    const buttons = listRef.current?.querySelectorAll('[role="tab"]');
    buttons?.[index]?.focus();
  };

  const handleKeyDown = (event) => {
    if (!NAV_KEYS.includes(event.key)) return;
    event.preventDefault();

    const enabledIndexes = [];
    tabs.forEach((tab, index) => {
      if (!tab.disabled) enabledIndexes.push(index);
    });
    if (enabledIndexes.length === 0) return;

    const currentIndex = tabs.findIndex((tab) => tab.value === value);
    let nextIndex;
    if (event.key === "Home") {
      nextIndex = enabledIndexes[0];
    } else if (event.key === "End") {
      nextIndex = enabledIndexes[enabledIndexes.length - 1];
    } else {
      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const position = enabledIndexes.indexOf(currentIndex);
      let nextPosition;
      if (position === -1) {
        nextPosition = direction === 1 ? 0 : enabledIndexes.length - 1;
      } else {
        nextPosition =
          (position + direction + enabledIndexes.length) % enabledIndexes.length;
      }
      nextIndex = enabledIndexes[nextPosition];
    }
    selectTab(tabs[nextIndex], nextIndex);
  };

  const selectedIndex = tabs.findIndex((tab) => tab.value === value);
  const firstEnabledIndex = tabs.findIndex((tab) => !tab.disabled);

  return (
    <div
      {...rest}
      ref={listRef}
      role="tablist"
      onKeyDown={handleKeyDown}
      className="flex border-b border-dd-border"
    >
      {tabs.map((tab, index) => {
        const active = tab.value === value;
        const tabbable =
          !tab.disabled &&
          (active || (selectedIndex === -1 && index === firstEnabledIndex));

        const tabClassName = [
          "relative inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium outline-none transition-colors focus-visible:shadow-dd-focus",
          active ? "text-dd-accent" : "text-dd-muted enabled:hover:text-dd-text",
          tab.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        ].join(" ");

        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={Boolean(tab.disabled)}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => selectTab(tab, index)}
            className={tabClassName}
          >
            {tab.icon ? (
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[18px] leading-none"
              >
                {tab.icon}
              </span>
            ) : null}
            {tab.label}
            {tab.count != null ? (
              <span className="dd-tnum rounded-full bg-dd-surface-2 px-1.5 py-0.5 text-xs leading-none text-dd-muted">
                {tab.count}
              </span>
            ) : null}
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-t-full bg-dd-accent"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
