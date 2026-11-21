import { NextResponse } from "next/server";
import { getComboById } from "@/lib/localDb";
import { getStaleComboSteps } from "@/lib/modelAutoSync/staleComboSteps.js";

export const dynamic = "force-dynamic";

// GET /api/combos/[id]/stale-steps - steps missing from the provider's live
// catalog (badge) plus steps the opt-in auto-prune removed (restorable).
// Guarded by the /api/combos management prefix, like the combo itself.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);
    if (!combo) return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    const stale = await getStaleComboSteps({ combos: [combo] });
    return NextResponse.json({ staleSteps: stale[combo.id] || [], prunedSteps: combo.prunedSteps || [] });
  } catch (error) {
    console.log("Error reading stale combo steps:", error);
    return NextResponse.json({ error: "Failed to read stale combo steps" }, { status: 500 });
  }
}
