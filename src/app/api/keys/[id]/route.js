import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey, getApiKeyUsageTotals } from "@/lib/localDb";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const [key, usage] = await Promise.all([
      getApiKeyById(id),
      getApiKeyUsageTotals(id),
    ]);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key: { ...key, usage: usage || { totalTokens: 0, totalCost: 0, totalRequests: 0 } } });
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
    const { isActive, allowedCombos, allowedModels, maxTokens, maxCostUsd } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (allowedCombos !== undefined) updateData.allowedCombos = allowedCombos;
    if (allowedModels !== undefined || maxTokens !== undefined || maxCostUsd !== undefined) {
      updateData.policy = {
        allowedModels: Array.isArray(allowedModels) ? allowedModels : existing.policy?.allowedModels ?? [],
        maxTokens: maxTokens !== undefined ? (maxTokens != null ? Number(maxTokens) : null) : existing.policy?.maxTokens ?? null,
        maxCostUsd: maxCostUsd !== undefined ? (maxCostUsd != null ? Number(maxCostUsd) : null) : existing.policy?.maxCostUsd ?? null,
      };
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
