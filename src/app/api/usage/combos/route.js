import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";
import { addLocalCalendarDays, getUsageCalendarCutoff, localDateFromKey, VALID_USAGE_STATS_PERIODS } from "@/lib/usagePeriods.js";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOUNDARY = "Combo and connection attribution starts with migration 014. Earlier history was never recorded with combo identity and remains separately unattributed.";

function parseDateKey(value) {
  if (!value) return null;
  if (!DATE_RE.test(value)) return false;
  try { return localDateFromKey(value); } catch { return false; }
}

function reportWindow(period, startDate, endDate, now = new Date()) {
  let start = parseDateKey(startDate);
  let end = parseDateKey(endDate);
  if (start === false || end === false || Boolean(start) !== Boolean(end)) return null;
  if (start && start > end) [start, end] = [end, start];

  let lower = null;
  if (start) {
    lower = start;
  } else if (period === "today") {
    lower = new Date(now);
    lower.setHours(0, 0, 0, 0);
  } else if (period === "24h") {
    lower = new Date(now.getTime() - DAY_MS);
  } else {
    lower = getUsageCalendarCutoff(period, now);
  }
  const endExclusive = end ? addLocalCalendarDays(end, 1) : null;
  const upperExclusive = Boolean(endExclusive && endExclusive <= now);
  return { lower, upper: upperExclusive ? endExclusive : now, upperExclusive };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    if (!VALID_USAGE_STATS_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const window = reportWindow(period, searchParams.get("startDate"), searchParams.get("endDate"));
    if (!window) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }
    const { lower, upper, upperExclusive } = window;
    const params = [];
    const bounds = [];
    if (lower) { bounds.push("timestamp >= ?"); params.push(lower.toISOString()); }
    bounds.push(`timestamp ${upperExclusive ? "<" : "<="} ?`);
    params.push(upper.toISOString());
    const boundsSql = `AND ${bounds.join(" AND ")}`;
    const db = await getAdapter();
    const rows = db.all(
      `SELECT comboId, comboName, connectionId, COUNT(*) AS requests,
        COALESCE(SUM(promptTokens), 0) AS promptTokens,
        COALESCE(SUM(completionTokens), 0) AS completionTokens,
        COALESCE(SUM(cost), 0) AS cost
       FROM usageHistory
       WHERE comboId IS NOT NULL AND comboName IS NOT NULL ${boundsSql}
       GROUP BY comboId, comboName, connectionId
       ORDER BY comboName COLLATE NOCASE, connectionId`,
      params,
    );
    const unattributed = db.get(
      `SELECT COUNT(*) AS requests,
        COALESCE(SUM(promptTokens), 0) AS promptTokens,
        COALESCE(SUM(completionTokens), 0) AS completionTokens,
        COALESCE(SUM(cost), 0) AS cost
       FROM usageHistory
       WHERE (comboId IS NULL OR comboName IS NULL) ${boundsSql}`,
      params,
    );
    return NextResponse.json({
      mode: "future-only",
      boundary: BOUNDARY,
      rows: rows.map((row) => ({
        comboId: row.comboId,
        comboName: row.comboName,
        connectionId: row.connectionId,
        requests: Number(row.requests || 0),
        promptTokens: Number(row.promptTokens || 0),
        completionTokens: Number(row.completionTokens || 0),
        cost: Number(row.cost || 0),
      })),
      unattributed: {
        requests: Number(unattributed?.requests || 0),
        promptTokens: Number(unattributed?.promptTokens || 0),
        completionTokens: Number(unattributed?.completionTokens || 0),
        cost: Number(unattributed?.cost || 0),
      },
    });
  } catch (error) {
    console.error("[API] Failed to get combo usage report:", error);
    return NextResponse.json({ error: "Failed to fetch combo usage report" }, { status: 500 });
  }
}
