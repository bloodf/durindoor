import { NextResponse } from "next/server";
import { getAllApiKeyUsageTotals, getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { isApiKeyExpiryValidationError } from "@/shared/utils/apiKeyExpiry";
import { toApiKeyManagementView } from "@/shared/utils/apiKeyManagement";
import { isApiKeyPolicyInputError, resolveApiKeyPolicyInput } from "@/shared/utils/apiKeyPolicyManagement";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const [keys, totals] = await Promise.all([getApiKeys(), getAllApiKeyUsageTotals()]);
    const totalsById = new Map(totals.map((usage) => [usage.apiKeyId, usage]));
    return NextResponse.json({
      keys: keys.map((key) => ({
        ...toApiKeyManagementView(key),
        usage: totalsById.get(key.id) || { totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null },
      })),
    });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const { name, allowedCombos, dailyLimitTokens, expiresAt } = body;
    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (!trimmedName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const policyInput = await resolveApiKeyPolicyInput(body, { create: true });
    const apiKey = await createApiKey(
      trimmedName,
      machineId,
      allowedCombos || [],
      dailyLimitTokens,
      expiresAt,
      { policy: policyInput.value },
    );

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      allowedCombos: apiKey.allowedCombos,
      dailyLimitTokens: apiKey.dailyLimitTokens,
      policy: apiKey.policy,
      usage: { totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null },
      expiresAt: apiKey.expiresAt,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    const status = /dailyLimitTokens/.test(error.message) || isApiKeyExpiryValidationError(error) || isApiKeyPolicyInputError(error) ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? error.message : "Failed to create key" }, { status });
  }
}
