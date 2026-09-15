import { NextResponse } from "next/server";
import {
  getAllApiKeyUsageTotals,
  getApiKeys,
  createApiKey,
  getProviderConnections,
  getApiKeyProviderConnectionIds,
  getApiKeyGroups,
  getGroupIdsByApiKey
} from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { isApiKeyExpiryValidationError } from "@/shared/utils/apiKeyExpiry";
import { toApiKeyManagementView } from "@/shared/utils/apiKeyManagement";
import { isApiKeyPolicyInputError, resolveApiKeyPolicyInput } from "@/shared/utils/apiKeyPolicyManagement";
import { isObject, isString } from "../../../shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

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

async function buildProviderConnectionScopeMap(keys) {
  const [connections, scopes] = await Promise.all([
    getProviderConnections(),
    Promise.all(keys.map((key) => getApiKeyProviderConnectionIds(key.id)))
  ]);
  return {
    options: connections.map((connection) => ({ id: connection.id, name: connection.name, provider: connection.provider })),
    scopes
  };
}

export async function GET() {
  try {
    // Group membership is fetched once for every key, not per key: a
    // per-row query would make the list O(keys) round trips.
    const [keys, totals, groups, groupIdsByKey] = await Promise.all([
      getApiKeys(),
      getAllApiKeyUsageTotals(),
      getApiKeyGroups(),
      getGroupIdsByApiKey(),
    ]);
    const totalsById = new Map(totals.map((usage) => [usage.apiKeyId, usage]));
    const { options, scopes } = await buildProviderConnectionScopeMap(keys);
    return NextResponse.json({
      providerConnections: options,
      groups,
      keys: keys.map((key, index) => ({
        ...toApiKeyManagementView(key),
        providerConnectionIds: scopes[index],
        groupIds: groupIdsByKey[key.id] || [],
        usage: totalsById.get(key.id) || { totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null }
      }))
    });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

export async function POST(request) {
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
    const trimmedName = isString(body.name) ? body.name.trim() : "";
    if (!trimmedName) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    const machineId = await getConsistentMachineId();
    const policyInput = await resolveApiKeyPolicyInput(body, { create: true });
    let providerConnectionIds;
    if ("providerConnectionIds" in body) {
      const availableIds = (await getProviderConnections()).map((connection) => connection.id);
      providerConnectionIds = validateProviderConnectionScope(body, availableIds);
    }
    const options = { policy: policyInput.value };
    if (providerConnectionIds !== undefined) options.providerConnectionIds = providerConnectionIds;
    const apiKey = await createApiKey(
      trimmedName,
      machineId,
      body.allowedCombos || [],
      body.dailyLimitTokens,
      body.expiresAt,
      options
    );
    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      allowedCombos: apiKey.allowedCombos,
      dailyLimitTokens: apiKey.dailyLimitTokens,
      policy: apiKey.policy,
      providerConnectionIds: providerConnectionIds || [],
      usage: { totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null },
      expiresAt: apiKey.expiresAt
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    const status = /dailyLimitTokens/.test(error.message) || isApiKeyExpiryValidationError(error) || isApiKeyPolicyInputError(error) || error instanceof TypeError ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? error.message : "Failed to create key" }, { status });
  }
}
