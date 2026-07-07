import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";

function normalizeExpiresAt(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return { error: "expiresAt must be an ISO date string or null" };
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return { error: "expiresAt must be a valid date" };
  if (time <= Date.now()) return { error: "expiresAt must be in the future" };
  return date.toISOString();
}

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isActive, allowedCombos } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (allowedCombos !== undefined) updateData.allowedCombos = allowedCombos;
    if (body.expiresAt !== undefined) {
      const expiresAt = normalizeExpiresAt(body.expiresAt);
      if (expiresAt?.error) {
        return NextResponse.json({ error: expiresAt.error }, { status: 400 });
      }
      updateData.expiresAt = expiresAt;
    }

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
