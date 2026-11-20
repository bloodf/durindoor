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

// The rotation response carries the replacement credential exactly once, so it
// must never be cached. This is the policy the other management credential
// responses already use (login, MFA enrollment, settings).
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

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
    return NextResponse.json(
      { error: "Rotating an API key requires an operator session" },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const { id } = await params;
    // The new secret is minted with the server's machine id, the same source
    // the create path uses, so a legacy secret is upgraded to the current
    // format on rotation.
    const machineId = await getConsistentMachineId();

    // The ancillary reads run before the swap, not after it. They describe the
    // key's row - usage totals, provider connections, groups - and a rotation
    // changes none of them, so reading them first costs no accuracy and closes
    // the window in which a failing read used to strand a committed rotation:
    // the replacement was already installed while the caller only saw a 500
    // and no secret. A read that fails here aborts before anything is written,
    // so the previous credential keeps working and the caller can retry.
    const [usage, providerConnectionIds, groupIds] = await Promise.all([
      getApiKeyUsageTotals(id),
      getApiKeyProviderConnectionIds(id),
      getGroupIdsForApiKey(id),
    ]);

    const outcome = await rotateApiKey(id, machineId);
    if (outcome.status === "not_found") {
      return NextResponse.json({ error: "Key not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (outcome.status === "conflict") {
      // Another rotation installed its secret first. Reporting a secret that
      // is not installed would be worse than the conflict.
      return NextResponse.json(
        { error: "Key was rotated by another request. Reload and try again." },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    // The swap is committed from here on, so nothing below may fail: the
    // response is assembled from values that are already in memory. The
    // installed replacement is delivered exactly once, in this body.
    const rotated = outcome.key;
    const view = toApiKeyManagementView(rotated);
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
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    // The failure itself is not logged. A database or key-generation error can
    // carry the row it touched, and a retired credential must never be written
    // down, so only the class of the failure is recorded.
    console.error("Error rotating key", { name: error?.name, code: error?.code });
    return NextResponse.json({ error: "Failed to rotate key" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
