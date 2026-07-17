/**
 * Shared Usage & Analytics period definitions (UI + API validation + aggregation).
 */

export const USAGE_PERIOD_OPTIONS = Object.freeze([
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "90d", label: "90D" },
  { value: "180d", label: "180D" },
  { value: "365d", label: "365D" },
  { value: "all", label: "All" },
].map(Object.freeze));

/** @type {Set<string>} */
export const VALID_USAGE_STATS_PERIODS = new Set(USAGE_PERIOD_OPTIONS.map((o) => o.value));

/** Chart supports the same day-based periods as stats (including all-time). */
export const VALID_USAGE_CHART_PERIODS = new Set(VALID_USAGE_STATS_PERIODS);

export const MAX_USAGE_CHART_BUCKETS = 366;
export const EMPTY_ALL_TIME_CHART_DAYS = 7;

/** Calendar-day lookback for daily rollup queries; `all` → null (no date filter). */
export const USAGE_PERIOD_DAYS = {
  "7d": 7,
  "30d": 30,
  "60d": 60,
  "90d": 90,
  "180d": 180,
  "365d": 365,
  all: null,
};

/**
 * @param {string} period
 * @returns {number | null}
 */
export function getUsagePeriodDays(period) {
  if (!VALID_USAGE_STATS_PERIODS.has(period)) {
    throw new RangeError(`Invalid usage period: ${period}`);
  }
  if (period === "today" || period === "24h") return null;
  if (period === "all") return null;
  return Object.prototype.hasOwnProperty.call(USAGE_PERIOD_DAYS, period)
    ? USAGE_PERIOD_DAYS[period]
    : null;
}

/**
 * Fixed bucket count for chart (daily bars). Returns null for `all` (variable length).
 * @param {string} period
 * @returns {number | null}
 */
export function getChartDayBucketCount(period) {
  const days = getUsagePeriodDays(period);
  return days;
}

/** Server-local calendar key used by persisted usageDaily rows. */
export function toLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid usage date");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localDateFromKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || "")) throw new RangeError("Invalid usage date key");
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (toLocalDateKey(date) !== dateKey) throw new RangeError("Invalid usage date key");
  return date;
}

export function addLocalCalendarDays(value, amount) {
  const date = value instanceof Date ? new Date(value) : localDateFromKey(value);
  date.setDate(date.getDate() + amount);
  return date;
}

/** Inclusive local-calendar cutoff. N-day windows include today and N-1 prior days. */
export function getUsageCalendarCutoff(period, now = new Date()) {
  const days = getUsagePeriodDays(period);
  if (days == null) return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return start;
}
