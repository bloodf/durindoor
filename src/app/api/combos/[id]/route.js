import { NextResponse } from "next/server";
import { getComboById } from "@/lib/localDb";
import { parseJsonBody } from "@/shared/utils/parseJsonBody";
import { ComboManagementError, deleteComboManaged, updateComboManaged } from "@/lib/combos/comboManagement";

// GET /api/combos/[id] - Get combo by ID
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

// PUT /api/combos/[id] - Update combo
export async function PUT(request, { params }) {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;

  try {
    const { id } = await params;
    const combo = await updateComboManaged(id, parsed.body);
    return NextResponse.json(combo);
  } catch (error) {
    if (error instanceof ComboManagementError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.log("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

// DELETE /api/combos/[id] - Delete combo
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    return NextResponse.json(await deleteComboManaged(id));
  } catch (error) {
    if (error instanceof ComboManagementError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.log("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
