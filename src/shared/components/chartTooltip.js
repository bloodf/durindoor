/**
 * Shared themed style objects for Recharts `<Tooltip>` components.
 *
 * Single source of truth for dashboard chart tooltip visuals. CSS-variable based
 * so tooltips follow the active Tailwind v4 theme (light/dark). Pass these as
 * the `contentStyle`, `labelStyle`, and `itemStyle` props of a Recharts
 * `<Tooltip>`; keep any existing `formatter`/`labelFormatter` on the call site.
 *
 * @example
 * import { chartTooltipContentStyle, chartTooltipLabelStyle, chartTooltipItemStyle } from "@/shared/components/chartTooltip";
 * <Tooltip
 *   contentStyle={chartTooltipContentStyle}
 *   labelStyle={chartTooltipLabelStyle}
 *   itemStyle={chartTooltipItemStyle}
 *   formatter={(v) => [v, "Label"]}
 * />
 */

/** Box style for the tooltip container. Theme-aware via CSS variables. */
export const chartTooltipContentStyle = {
  backgroundColor: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  fontSize: "12px",
  color: "var(--color-text)",
};

/** Color for the tooltip label (top line, usually the x-axis value). */
export const chartTooltipLabelStyle = {
  color: "var(--color-text)",
};

/** Color for each tooltip item row. */
export const chartTooltipItemStyle = {
  color: "var(--color-text)",
};
