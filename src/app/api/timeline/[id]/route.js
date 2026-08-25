import { NextResponse } from "next/server";
import { getTrace } from "@/lib/db/repos/proxyTimelineRepo.js";

/** GET /api/timeline/:id — one sidecar trace plus events in seq order. */
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const row = await getTrace(id);
    if (!row) return NextResponse.json({ error: "Trace not found" }, { status: 404 });
    const { events = [], ...trace } = row;
    const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    return NextResponse.json({ trace, events: ordered });
  } catch (error) {
    console.error("[API] Failed to get timeline trace:", error);
    return NextResponse.json({ error: "Failed to get timeline trace" }, { status: 500 });
  }
}
