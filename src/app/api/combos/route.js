import { NextResponse } from "next/server";
import { getCombos } from "@/lib/localDb";
import { parseJsonBody } from "@/shared/utils/parseJsonBody";
import { ComboManagementError, createComboManaged } from "@/lib/combos/comboManagement";

export const dynamic = "force-dynamic";

// GET /api/combos - Get all combos
export async function GET() {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  try {
    const combo = await createComboManaged(parsed.body);
    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    if (error instanceof ComboManagementError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
