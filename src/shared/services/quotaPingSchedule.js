import { isNumber, isObject, isString } from "../utils/typeChecks.js";

// Anchored ping schedule: fires pings at fixed local wall-clock slots instead of
// (or on top of) the reactive "ping right after reset" behaviour.
//
// With anchor 09:30, a 5h window and 3 slots/day the schedule is
// 09:30 / 14:30 / 19:30 local time — the overnight gap is what re-aligns the
// next day back onto the 09:30 anchor, since 24h is not a multiple of 5h.

export function getLocalTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const PING_SCHEDULE_DEFAULTS = {
  anchor: "09:30",
  timezone: getLocalTimezone(),
  windowHours: 5,
  slotsPerDay: 3,
};

// Fire a slot that came due while the process was down/busy, but never a stale one.
export const SLOT_GRACE_MS = 30 * 60 * 1000;

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

function isValidTimezone(timezone) {
  if (!timezone || !isString(timezone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function parseAnchor(anchor) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(anchor || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function maxSlotsPerDay(windowHours) {
  return Math.max(1, Math.floor(24 / windowHours));
}

function clampNumber(value, fallback, min, max) {
  const parsed = isNumber(value) ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

// Returns a fully-defaulted schedule, or null when it is absent/disabled/invalid.
export function normalizePingSchedule(raw) {
  if (!raw || raw.enabled !== true) return null;

  const anchorParts = parseAnchor(raw.anchor) || parseAnchor(PING_SCHEDULE_DEFAULTS.anchor);
  const anchor = `${String(anchorParts.hour).padStart(2, "0")}:${String(anchorParts.minute).padStart(2, "0")}`;
  const timezone = isValidTimezone(raw.timezone) ? raw.timezone : PING_SCHEDULE_DEFAULTS.timezone;
  const windowHours = clampNumber(raw.windowHours, PING_SCHEDULE_DEFAULTS.windowHours, 0.5, 24);
  const slotsPerDay = Math.round(
    clampNumber(raw.slotsPerDay, PING_SCHEDULE_DEFAULTS.slotsPerDay, 1, maxSlotsPerDay(windowHours))
  );

  return { enabled: true, anchor, timezone, windowHours, slotsPerDay };
}

function zonedParts(utcMs, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const out = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

function zoneOffsetMs(utcMs, timezone) {
  const p = zonedParts(utcMs, timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

// Wall-clock time in `timezone` → UTC epoch ms (second pass covers DST shifts).
function zonedWallClockToUtcMs({ year, month, day, hour, minute }, timezone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const offset = zoneOffsetMs(naive, timezone);
  const candidate = naive - offset;
  const refinedOffset = zoneOffsetMs(candidate, timezone);
  return refinedOffset === offset ? candidate : naive - refinedOffset;
}

function slotKey(schedule, p, index) {
  const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return `${date}#${schedule.anchor}#${index}`;
}

// All slots belonging to the calendar date `p` ({year, month, day}) in the schedule timezone.
function slotsForAnchorDay(schedule, p) {
  const { hour, minute } = parseAnchor(schedule.anchor);
  const firstAt = zonedWallClockToUtcMs({ year: p.year, month: p.month, day: p.day, hour, minute }, schedule.timezone);

  return Array.from({ length: schedule.slotsPerDay }, (_, index) => ({
    key: slotKey(schedule, p, index),
    index,
    at: firstAt + index * schedule.windowHours * HOUR_MS,
  }));
}

// Slots from yesterday + today + tomorrow cover everything that can already be due, since a
// day's slots never span more than 24h from its anchor. Calendar dates are stepped from the
// zoned date (noon UTC) so DST days with 23h/25h do not skip or repeat a date.
export function getScheduleSlots(schedule, nowMs = Date.now()) {
  const normalized = normalizePingSchedule(schedule);
  if (!normalized) return [];
  const t = zonedParts(nowMs, normalized.timezone);
  return [-1, 0, 1].flatMap((delta) => {
    const d = new Date(Date.UTC(t.year, t.month - 1, t.day + delta, 12));
    return slotsForAnchorDay(normalized, { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
  }).sort((x, y) => x.at - y.at);
}

// Most recent slot that is due and still inside the grace window.
export function getDuePingSlot(schedule, nowMs = Date.now(), graceMs = SLOT_GRACE_MS) {
  const due = getScheduleSlots(schedule, nowMs).filter((slot) => slot.at <= nowMs && nowMs - slot.at <= graceMs);
  return due.length ? due[due.length - 1] : null;
}

export function getNextPingSlot(schedule, nowMs = Date.now()) {
  return getScheduleSlots(schedule, nowMs).find((slot) => slot.at > nowMs) || null;
}

// "09:30 → 14:30 → 19:30" preview for the UI; window end of the last slot included by caller.
export function getScheduleSlotLabels(schedule) {
  const normalized = normalizePingSchedule(schedule);
  if (!normalized) return [];
  const { hour, minute } = parseAnchor(normalized.anchor);
  const startMinutes = hour * 60 + minute;

  return Array.from({ length: normalized.slotsPerDay }, (_, index) => {
    const total = Math.round(startMinutes + index * normalized.windowHours * 60) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  });
}

// Strict validation for the write API: reject what normalizePingSchedule would
// silently default, so the stored schedule is exactly what the operator chose.
export function validatePingSchedule(raw) {
  if (raw === null || raw?.enabled === false) return { schedule: null };
  if (!raw || !isObject(raw) || Array.isArray(raw) || raw.enabled !== true) {
    return { error: "schedule must be null or an object with enabled true/false" };
  }
  if (!parseAnchor(raw.anchor)) return { error: "schedule.anchor must be HH:MM" };
  if (!isValidTimezone(raw.timezone)) return { error: "schedule.timezone must be an IANA timezone" };
  const { windowHours, slotsPerDay } = raw;
  if (!isNumber(windowHours) || !Number.isFinite(windowHours) || windowHours < 1 || windowHours > 24) {
    return { error: "schedule.windowHours must be between 1 and 24" };
  }
  if (!Number.isInteger(slotsPerDay) || slotsPerDay < 1 || slotsPerDay > maxSlotsPerDay(windowHours)) {
    return { error: `schedule.slotsPerDay must be an integer between 1 and ${maxSlotsPerDay(windowHours)}` };
  }
  return { schedule: normalizePingSchedule(raw) };
}
