import { NextResponse } from "next/server";
import { canManageAccessConfig } from "@/dashboardGuard";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { toApiKeyManagementView } from "@/shared/utils/apiKeyManagement";
import {
  getApiKeyProviderConnectionIds,
  getApiKeyUsageTotals,
  getGroupIdsForApiKey,
  rotateApiKey,
} from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/keys/[id]/rotate - Replace the key's secret, keep everything else.
//
// The permission is the one every key mutation uses: an operator session or an
// admin-scoped key. The caller that may create a key and read its secret may
// therefore rotate one and read the replacement, exactly once.
//
// The rotation keeps the key's row, so its id, scope, policy, quota, groups and
// history survive: the secret is the credential, the row is the account. The
// retired secret stops validating the moment this returns, and it is never
// stored, logged or returned.
export async function POST(request, { params }) {
  if (!(await canManageAccessConfig(request))) {
    return NextResponse.json({ error: "Rotating an API key requires an operator session" }, { status: 403 });
  }

  try {
    const { id } = await params;
    // The new secret is minted with the server's machine id, the same source
    // the create path uses, so a legacy secret is upgraded to the current
    // format on rotation.
    const machineId = await getConsistentMachineId();
    const outcome = await rotateApiKey(id, machineId);
    if (outcome.status === "not_found") {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    if (outcome.status === "conflict") {
      // Another rotation installed its secret first. Reporting a secret that
      // is not installed would be worse than the conflict.
      return NextResponse.json({ error: "Key was rotated by another request. Reload and try again." }, { status: 409 });
    }

    const rotated = outcome.key;
    const view = toApiKeyManagementView(rotated);
    const [usage, providerConnectionIds, groupIds] = await Promise.all([
      getApiKeyUsageTotals(id),
      getApiKeyProviderConnectionIds(id),
      getGroupIdsForApiKey(id),
    ]);
    return NextResponse.json({
      // The new secret, revealed once. The retired one is not part of it.
      key: rotated.key,
      id: view.id,
      name: view.name,
      maskedKey: view.maskedKey,
      machineId: view.machineId,
      isActive: view.isActive,
      allowedCombos: view.allowedCombos,
      dailyLimitTokens: view.dailyLimitTokens,
      policy: view.policy,
      expiresAt: view.expiresAt,
      isAdmin: view.isAdmin,
      createdAt: view.createdAt,
      providerConnectionIds,
      groupIds,
      usage,
    });
  } catch (error) {
    console.log("Error rotating key:", error);
    return NextResponse.json({ error: "Failed to rotate key" }, { status: 500 });
  }
}
