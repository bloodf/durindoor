/**
 * Shared themed style objects for Recharts `<Tooltip>` components.
 *
 * Single source of truth for dashboard chart tooltip visuals. CSS-variable based
 * so tooltips follow the active Durin DS theme (light "Parchment" / dark
 * "Moria stone"). Pass these as the `contentStyle`, `labelStyle`, and
 * `itemStyle` props of a Recharts `<Tooltip>`; keep any existing
 * `formatter`/`labelFormatter` on the call site.
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

/** Box style for the tooltip container. Theme-aware via DS tokens. */
export const chartTooltipContentStyle = {
  backgroundColor: "var(--dd-surface)",
  border: "1px solid var(--dd-border)",
  borderRadius: "var(--dd-radius)",
  fontSize: "12px",
  color: "var(--dd-text)",
  boxShadow: "var(--dd-shadow-elevated)",
  padding: "8px 10px",
};

/** Color for the tooltip label (top line, usually the x-axis value). */
export const chartTooltipLabelStyle = {
  color: "var(--dd-text)",
  fontWeight: 500,
  marginBottom: 2,
};

/** Color for each tooltip item row. */
export const chartTooltipItemStyle = { color: "var(--dd-text)", padding: "1px 0" };
