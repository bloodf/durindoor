import { NextResponse } from "next/server";
import { getTraceMeta } from "@/lib/db/repos/proxyTimelineRepo.js";

/** GET /api/timeline/:id/meta — overview metadata, never event payloads. */
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const trace = await getTraceMeta(id);
    if (!trace) return NextResponse.json({ error: "Trace not found" }, { status: 404 });
    return NextResponse.json({ trace });
  } catch (error) {
    console.error("[API] Failed to get timeline metadata:", error);
    return NextResponse.json({ error: "Failed to get timeline metadata" }, { status: 500 });
  }
}
