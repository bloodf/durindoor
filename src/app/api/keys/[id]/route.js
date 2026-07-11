import { NextResponse } from "next/server";
import { isApiKeyExpiryValidationError } from "@/shared/utils/apiKeyExpiry";
import { toApiKeyManagementView } from "@/shared/utils/apiKeyManagement";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key: toApiKeyManagementView(key) });
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
    const { name, isActive, allowedCombos, dailyLimitTokens, expiresAt } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if ("name" in body) {
      const trimmedName = typeof name === "string" ? name.trim() : "";
      if (!trimmedName) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      updateData.name = trimmedName;
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (allowedCombos !== undefined) updateData.allowedCombos = allowedCombos;
    if ("dailyLimitTokens" in body) updateData.dailyLimitTokens = dailyLimitTokens;
    if ("expiresAt" in body) updateData.expiresAt = expiresAt;

    const updated = await updateApiKey(id, updateData);
    if (!updated) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ key: toApiKeyManagementView(updated) });
  } catch (error) {
    console.log("Error updating key:", error);
    const status = /dailyLimitTokens/.test(error.message) || isApiKeyExpiryValidationError(error) ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? error.message : "Failed to update key" }, { status });
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
