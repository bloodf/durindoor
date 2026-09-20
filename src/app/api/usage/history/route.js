import { NextResponse } from "next/server";
import { listUsageHistoryPage } from "@/lib/db/repos/usageRepo.js";

const FILTER_KEYS = ["provider", "model", "connectionId", "status", "startDate", "endDate"];

function pageNumber(value, fallback, maximum) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return null;
  return Math.min(number, maximum);
}

/** GET /api/usage/history — bounded rows, total count, limit and offset. */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = pageNumber(searchParams.get("limit"), 50, 200);
    const offset = pageNumber(searchParams.get("offset"), 0, 2147483647);
    if (limit === null || limit < 1 || offset === null) {
      return NextResponse.json({ error: "limit must be a positive integer and offset a nonnegative integer" }, { status: 400 });
    }
    const filters = {};
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value !== null) filters[key] = value;
    }
    for (const key of ["startDate", "endDate"]) {
      if (filters[key] !== undefined) {
        const value = filters[key];
        const date = new Date(value);
        const dateKey = value.slice(0, 10);
        const calendarDate = new Date(`${dateKey}T00:00:00.000Z`);
        if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) ||
            !Number.isFinite(date.getTime()) || !Number.isFinite(calendarDate.getTime()) ||
            calendarDate.toISOString().slice(0, 10) !== dateKey) {
          return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
        }
        filters[key] = date.toISOString();
      }
    }
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
      return NextResponse.json({ error: "startDate must not exceed endDate" }, { status: 400 });
    }
    const result = await listUsageHistoryPage({ limit, offset, filters });
    return NextResponse.json({ ...result, limit, offset });
  } catch (error) {
    console.error("Error fetching usage history:", error);
    return NextResponse.json({ error: "Failed to fetch usage history" }, { status: 500 });
  }
}
