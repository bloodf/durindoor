import { NextResponse } from "next/server";
import { isApiKeyExpiryValidationError } from "@/shared/utils/apiKeyExpiry";
import { toApiKeyManagementView } from "@/shared/utils/apiKeyManagement";
import { isApiKeyPolicyInputError, resolveApiKeyPolicyInput } from "@/shared/utils/apiKeyPolicyManagement";
import {
  deleteApiKey,
  getApiKeyById,
  getApiKeyUsageTotals,
  getProviderConnections,
  getApiKeyProviderConnectionIds,
  updateApiKey
} from "@/lib/localDb";
import { isObject, isString } from "../../../../shared/utils/typeChecks.js";

function validateProviderConnectionScope(body, availableIds) {
  if (!("providerConnectionIds" in body)) return undefined;
  const value = body.providerConnectionIds;
  if (!Array.isArray(value) || value.some((id) => !isString(id) || !id.trim())) {
    throw new TypeError("providerConnectionIds must be an array of provider connection id strings");
  }
  const ids = value.map((id) => id.trim());
  if (new Set(ids).size !== ids.length) throw new TypeError("providerConnectionIds must not contain duplicates");
  const known = new Set(availableIds);
  if (ids.some((id) => !known.has(id))) throw new TypeError("Provider connection not found");
  return ids;
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    const [usage, providerConnectionIds] = await Promise.all([
      getApiKeyUsageTotals(id),
      getApiKeyProviderConnectionIds(id)
    ]);
    return NextResponse.json({ key: { ...toApiKeyManagementView(key), providerConnectionIds, usage } });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

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
    const existing = await getApiKeyById(id);
    if (!existing) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    const updateData = {};
    if ("name" in body) {
      const trimmedName = isString(body.name) ? body.name.trim() : "";
      if (!trimmedName) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      updateData.name = trimmedName;
    }
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.allowedCombos !== undefined) updateData.allowedCombos = body.allowedCombos;
    if ("dailyLimitTokens" in body) updateData.dailyLimitTokens = body.dailyLimitTokens;
    if ("expiresAt" in body) updateData.expiresAt = body.expiresAt;
    if ("providerConnectionIds" in body) {
      const availableIds = (await getProviderConnections()).map((connection) => connection.id);
      updateData.providerConnectionIds = validateProviderConnectionScope(body, availableIds);
    }
    const policyInput = await resolveApiKeyPolicyInput(body);
    if (policyInput.present) {
      if (Object.hasOwn(policyInput, "value")) updateData.policy = policyInput.value;
      else updateData.policyPatch = policyInput.patch;
    }

    const updated = await updateApiKey(id, updateData);
    if (!updated) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    const [usage, providerConnectionIds] = await Promise.all([
      getApiKeyUsageTotals(id),
      getApiKeyProviderConnectionIds(id)
    ]);
    return NextResponse.json({ key: { ...toApiKeyManagementView(updated), providerConnectionIds, usage } });
  } catch (error) {
    console.log("Error updating key:", error);
    const status = /dailyLimitTokens/.test(error.message) || isApiKeyExpiryValidationError(error) || isApiKeyPolicyInputError(error) || error instanceof TypeError ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? error.message : "Failed to update key" }, { status });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteApiKey(id);
    if (!deleted) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
