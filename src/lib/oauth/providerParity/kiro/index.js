/**
 * Staged web registration payload. MIT attribution: OmniRoute b15b2ee6,
 * src/lib/oauth/providers/kiro.ts. Existing flowStore owns state and persistence.
 */
export function buildKiroRegistration(config, authMethod = "builder-id") {
  if (!["builder-id", "idc"].includes(authMethod)) throw new Error("Unsupported Kiro device method");
  return {
    clientName: config.clientName,
    clientType: config.clientType,
    scopes: config.scopes,
    grantTypes: config.grantTypes,
    ...(authMethod === "builder-id" && config.issuerUrl ? { issuerUrl: config.issuerUrl } : null),
  };
}
