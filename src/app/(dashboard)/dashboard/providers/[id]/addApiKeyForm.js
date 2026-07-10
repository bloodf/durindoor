export const ACCOUNT_ID_PROVIDER_DETAILS = ["cloudflare-ai", "snowflake"];

export function buildAccountIdProviderData(provider, accountId) {
  if (!ACCOUNT_ID_PROVIDER_DETAILS.includes(provider)) return undefined;
  const normalizedAccountId = typeof accountId === "string" ? accountId.trim() : "";
  return normalizedAccountId ? { accountId: normalizedAccountId } : null;
}

export async function validateAndSaveProviderConnection({
  provider,
  apiKey,
  providerSpecificData,
  connection,
  onSave,
  fetchImpl = fetch,
}) {
  let normalizedProviderData = providerSpecificData;
  const requiresAccountId = ACCOUNT_ID_PROVIDER_DETAILS.includes(provider);
  if (requiresAccountId) {
    normalizedProviderData = buildAccountIdProviderData(provider, providerSpecificData?.accountId);
    if (!normalizedProviderData) return false;
  }

  let isValid = false;
  try {
    const response = await fetchImpl("/api/providers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey, providerSpecificData: normalizedProviderData }),
    });
    const validation = await response.json();
    isValid = !!validation.valid;
  } catch {}

  if (!isValid && requiresAccountId) return false;
  await onSave({
    ...connection,
    testStatus: isValid ? "active" : "unknown",
    providerSpecificData: normalizedProviderData,
  });
  return isValid;
}
