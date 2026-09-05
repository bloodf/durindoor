/**
 * Formats a token total for constrained metric surfaces. `title` always keeps
 * the locale-formatted exact total so compact display never loses precision.
 *
 * @param {number} value token total
 * @returns {{ display: string, title: string }} compact display and exact tooltip
 */
export function formatCompactToken(value) {
  const total = Number.isFinite(value) ? value : 0;
  const title = new Intl.NumberFormat().format(total);
  const abs = Math.abs(total);
  if (abs < 1_000) return { display: title, title };

  const units = [[1_000_000_000_000, "T"], [1_000_000_000, "B"], [1_000_000, "M"], [1_000, "k"]];
  let unitIndex = units.findIndex(([divisor]) => abs >= divisor);
  let [divisor, suffix] = units[unitIndex];
  let scaled = total / divisor;
  let decimals = Math.abs(scaled) < 10 ? 1 : 0;
  if (Math.abs(scaled) >= 999.5 && unitIndex > 0) {
    [divisor, suffix] = units[--unitIndex];
    scaled = total / divisor;
    decimals = Math.abs(scaled) < 10 ? 1 : 0;
  }
  return { display: `${scaled.toFixed(decimals)}${suffix}`, title };
}
