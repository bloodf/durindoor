import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { VALID_USAGE_STATS_PERIODS } from "@/lib/usagePeriods.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_USAGE_STATS_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    // Optional custom calendar range (YYYY-MM-DD). getUsageStats validates the
    // shape/order defensively and ignores it unless both are well-formed.
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const stats = await getUsageStats(period, { startDate, endDate });
    return NextResponse.json(stats);
  } catch (error) {
    console.error("[API] Failed to get usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
