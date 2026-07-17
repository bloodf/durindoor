import { NextResponse } from "next/server";
import { getHeadroomStats } from "@/lib/headroom/events.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const recentLimit = Math.min(Number(searchParams.get("limit")) || 100, 500);
    return NextResponse.json(getHeadroomStats({ recentLimit }));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
