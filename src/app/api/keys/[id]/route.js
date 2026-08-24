import { NextResponse } from "next/server";
import { isApiKeyExpiryValidationError } from "@/shared/utils/apiKeyExpiry";
import { toApiKeyManagementView } from "@/shared/utils/apiKeyManagement";
import { isApiKeyPolicyInputError, resolveApiKeyPolicyInput } from "@/shared/utils/apiKeyPolicyManagement";
import { deleteApiKey, getApiKeyById, getApiKeyUsageTotals, updateApiKey } from "@/lib/localDb";

// GET /api/keys/[id] - Get single key
import { isObject, isString } from "../../../../shared/utils/typeChecks.js";
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    const usage = await getApiKeyUsageTotals(id);
    return NextResponse.json({ key: { ...toApiKeyManagementView(key), usage } });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || !isObject(body) || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const { id } = await params;
    const { name, isActive, allowedCombos, dailyLimitTokens, expiresAt } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if ("name" in body) {
      const trimmedName = isString(name) ? name.trim() : "";
      if (!trimmedName) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      updateData.name = trimmedName;
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (allowedCombos !== undefined) updateData.allowedCombos = allowedCombos;
    if ("dailyLimitTokens" in body) updateData.dailyLimitTokens = dailyLimitTokens;
    if ("expiresAt" in body) updateData.expiresAt = expiresAt;
    const policyInput = await resolveApiKeyPolicyInput(body);
    if (policyInput.present) {
      if (Object.hasOwn(policyInput, "value")) updateData.policy = policyInput.value;else
      updateData.policyPatch = policyInput.patch;
    }

    const updated = await updateApiKey(id, updateData);
    if (!updated) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const usage = await getApiKeyUsageTotals(id);
    return NextResponse.json({ key: { ...toApiKeyManagementView(updated), usage } });
  } catch (error) {
    console.log("Error updating key:", error);
    const status = /dailyLimitTokens/.test(error.message) || isApiKeyExpiryValidationError(error) || isApiKeyPolicyInputError(error) ? 400 : 500;
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