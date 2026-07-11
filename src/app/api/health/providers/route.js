import { NextResponse } from "next/server";
import { getHealthPayload, invalidateHealthCache } from "@/lib/healthMonitor";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// GET /api/health/providers — short-TTL cached provider health payload.
// `?force=1` bypasses the cache for this request.
export async function GET(request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const payload = await getHealthPayload({ force });
    return NextResponse.json(payload, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to compute provider health", message: sanitizeErrorMessage(error?.message) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// DELETE /api/health/providers — invalidate the cache (e.g. after a reset).
export async function DELETE() {
  invalidateHealthCache();
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
