/**
 * OAuth-session providers listed here cannot start a browser authorize flow
 * from the dashboard. They must import a token bundle captured by the CLI.
 */
export const IMPORT_TOKEN_OAUTH_PROVIDERS = new Set(["grok-cli"]);

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
