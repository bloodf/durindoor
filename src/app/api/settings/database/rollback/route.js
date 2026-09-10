// POST /api/settings/database/rollback
//
// Rolls the engine back to SQLite by restoring the most recent cutover
// snapshot. Body: `{ snapshotPath? }` (optional; defaults to the most
// recent snapshot under DATA_DIR/db/backups/).

import { NextResponse } from "next/server";
import { requireDatabaseDualAuth } from "../route";
import { runRollback } from "@/lib/db/cutover";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!(await requireDatabaseDualAuth(request, request.headers.get("x-9r-password")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body = {};
  try { body = await request.json(); } catch { /* empty body is OK */ }
  const out = await runRollback({ snapshotPath: body.snapshotPath });
  return NextResponse.json(out, { status: out.ok ? 200 : 500 });
}
