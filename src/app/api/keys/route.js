import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { isApiKeyExpiryValidationError } from "@/shared/utils/apiKeyExpiry";
import { toApiKeyManagementView } from "@/shared/utils/apiKeyManagement";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys: keys.map(toApiKeyManagementView) });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, allowedCombos, dailyLimitTokens, expiresAt } = body;
    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (!trimmedName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(trimmedName, machineId, allowedCombos || [], dailyLimitTokens, expiresAt);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      allowedCombos: apiKey.allowedCombos,
      dailyLimitTokens: apiKey.dailyLimitTokens,
      expiresAt: apiKey.expiresAt,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    const status = /dailyLimitTokens/.test(error.message) || isApiKeyExpiryValidationError(error) ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? error.message : "Failed to create key" }, { status });
  }
}
