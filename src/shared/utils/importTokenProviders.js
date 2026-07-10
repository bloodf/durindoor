/**
 * OAuth-session providers listed here cannot start a browser/device authorize flow
 * from the dashboard and must import a token bundle captured by the CLI.
 *
 * Empty today: grok-cli moved to a real device-code flow (#2502).
 */
export const IMPORT_TOKEN_OAUTH_PROVIDERS = new Set([]);

export function isImportTokenOAuthProvider(providerId) {
  return IMPORT_TOKEN_OAUTH_PROVIDERS.has(providerId);
}

export function buildImportTokenPayload(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
