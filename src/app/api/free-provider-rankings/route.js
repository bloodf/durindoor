import { NextResponse } from "next/server";
import { computeFreeProviderRankings } from "open-sse/services/freeProviderRankings.js";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const VALID_CATEGORIES = new Set(["noauth", "freeTier", "free", "oauth", "apikey"]);

// GET /api/free-provider-rankings[?category=][&limit=]
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const category = url.searchParams.get("category") || undefined;
    const limitRaw = url.searchParams.get("limit");

    if (category && !VALID_CATEGORIES.has(category)) {
      return NextResponse.json(
        { error: "Invalid category", allowed: [...VALID_CATEGORIES] },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    let limit = 100;
    if (limitRaw) {
      const n = Number(limitRaw);
      if (Number.isFinite(n) && n >= 1) limit = Math.min(Math.round(n), 500);
    }

    const rankings = computeFreeProviderRankings({ category, limit });
    return NextResponse.json({ rankings }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to compute rankings", message: sanitizeErrorMessage(error?.message) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
