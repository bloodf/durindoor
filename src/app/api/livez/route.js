import { NextResponse } from "next/server";

// Process-alive probe (ported from OmniRoute #10977 — Kubernetes-style
// liveness). Distinct from /api/health (readiness): this never touches the
// database, catalog, or providers, and always answers 200 as long as the
// Node event loop can run this handler at all. A restart-on-liveness-failure
// policy should point here, not at /api/health, so a slow DB never triggers
// an unnecessary container restart.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
