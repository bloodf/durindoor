import { NextResponse } from "next/server";
import { restorePrunedSteps, ComboMemberError } from "@/lib/db/repos/combosRepo.js";
import { ComboInvariantError } from "@/lib/combos/invariants.js";
import { resetComboRotation, resetComboScoring } from "open-sse/services/combo.js";
import { isObject, isString } from "@/shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

// POST /api/combos/[id]/restore - put auto-pruned steps back on the combo.
// Body (optional): { models: string[] } restores only those; omitted restores all.
// Same authorization as combo edits: /api/combos is a management API path, so
// the dashboard guard requires a dashboard session or CLI token before this runs.
export async function POST(request, { params }) {
  let models = null;
  // An empty body restores everything; a present body must be a JSON object.
  const raw = await request.text();
  if (raw.trim()) {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    if (body === null || !isObject(body) || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (body.models !== undefined) {
      if (!Array.isArray(body.models) || body.models.some((m) => !isString(m))) {
        return NextResponse.json({ error: "models must be an array of strings" }, { status: 400 });
      }
      models = body.models;
    }
  }
  try {
    const { id } = await params;
    const result = await restorePrunedSteps(id, { models });
    if (!result) return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    if (result.combo?.name) { resetComboRotation(result.combo.name); resetComboScoring(result.combo.name); }
    return NextResponse.json({ combo: result.combo, restored: result.restored });
  } catch (error) {
    if (error instanceof ComboMemberError || error instanceof ComboInvariantError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.log("Error restoring combo steps:", error);
    return NextResponse.json({ error: "Failed to restore combo steps" }, { status: 500 });
  }
}
