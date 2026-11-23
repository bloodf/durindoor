import { isNumber } from "../../shared/utils/typeChecks.js";

/** Decode a numeric provider USD receipt; null means invalid or absent. */
export function decodeUsdReceipt(value, field) {
  if (!isNumber(value) || !Number.isFinite(value) || value < 0) return null;
  return field === "cost_in_usd_ticks" ? value / 1e10 : value;
}
