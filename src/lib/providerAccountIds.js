export const ACCOUNT_ID_PROVIDERS = new Set(["cloudflare-ai", "snowflake"]);

export function requiresProviderAccountId(provider) {
  return ACCOUNT_ID_PROVIDERS.has(provider);
}

/**
 * Parse one bulk API-key line without silently creating an unusable account-
 * scoped connection. Account-scoped providers require name|apiKey|accountId.
 */
export function parseBulkApiKeyLine(line, index, provider) {
  const parts = String(line || "").split("|");
  const baseName = parts.length >= 2 ? parts[0].trim() : "Key";
  const name = `${baseName || "Key"} ${index + 1}`;

  if (requiresProviderAccountId(provider)) {
    if (parts.length < 3) throw new Error(`${provider} bulk entries require name|apiKey|accountId`);
    const apiKey = parts.slice(1, -1).join("|").trim();
    const accountId = parts.at(-1).trim();
    if (!apiKey || !accountId) throw new Error(`${provider} bulk entries require apiKey and accountId`);
    return { name, apiKey, providerSpecificData: { accountId } };
  }

  // Muse keys are the whole LLM|id|secret string: keep it opaque (upstream a199d777).
  const trimmed = String(line || "").trim();
  if (/^LLM\|[^|\s]+\|[^|\s]+$/i.test(trimmed)) {
    return { name: `LLM ${index + 1}`, apiKey: trimmed, providerSpecificData: undefined };
  }

  const apiKey = parts.length >= 2 ? parts.slice(1).join("|").trim() : parts[0].trim();
  if (!apiKey) throw new Error("Bulk entry requires an API key");
  return { name, apiKey, providerSpecificData: undefined };
}
