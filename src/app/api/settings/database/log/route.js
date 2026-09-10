// GET /api/settings/database/log
//
// Returns the most recent `pgCutoverLog` rows (newest first). Used by
// the dashboard to render the cutover history. Limit defaults to 50.

import { NextResponse } from "next/server";
import { requireDatabaseDualAuth } from "../route";
import { getAdapter } from "@/lib/db/driver";
import { listCutoverLog } from "@/lib/db/dialects/postgres/cutoverLog";

export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!(await requireDatabaseDualAuth(request, request.headers.get("x-9r-password")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit") || "50", 10) || 50));
  try {
    const adapter = await getAdapter();
    if (!adapter || !adapter.capabilities || !adapter.capabilities.isPostgres) {
      return NextResponse.json({ rows: [], engine: "sqlite" });
    }
    const rows = await listCutoverLog(adapter, { limit });
    return NextResponse.json({ rows, engine: "postgres" });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to read log" }, { status: 500 });
  }
}
